# Lookup patterns for partner threads

Templates for the checks partner threads keep needing. Adapt the table, column and class names to
your app, run each one, then copy the values it returns into the draft's Facts with the time you
ran it. Names below (`venues`, `place_data`, `Places::Client`, …) are placeholders from the
invented examples, and `<mirrored_table>` / `<schema>` are yours to fill in.

## Our side: is the warehouse fresh enough?

Only if the project has a warehouse (**warehouse-data** owns the details). Before trusting a row
for "today", check the mirror's lag:

```sql
select max(updated_at) from <schema>.<mirrored_table>;
```

A single record's own `updated_at` can be older simply because nothing changed.

## Our side: which items have no match (JSON column, flattened)

Partner payloads often land in a JSON column. A plain `select *` returns tens of KB per row, so
flatten instead. This finds, per venue, the weekdays that have no opening-hours period — the kind
of gap a "has opening hours" flag hides (Snowflake syntax; Postgres uses `jsonb_array_elements` /
`jsonb_each`, and works the same on the dev DB):

```sql
with ids as (select value::string as partner_ref
             from table(flatten(input => parse_json('["place_7720","place_7731"]')))),
v as (select v.* from <schema>.venues v join ids using (partner_ref) where v.archived_at is null),
days as (select v.id, d.value::int as day
         from v, table(flatten(input => parse_json('[0,1,2,3,4,5,6]'))) d),
covered as (select distinct v.id, p.value:open:day::int as day
            from v, lateral flatten(input => v.place_data:opening_hours:periods) p)
select v.partner_ref, v.name, v.updated_at,
       listagg(case when covered.day is null then days.day end, ', ') as days_without_hours,
       count(covered.day) as days_with_hours
from v join days on days.id = v.id
left join covered on covered.id = days.id and covered.day = days.day
group by 1, 2, 3
```

An id with no row has no record on our side yet. Gotcha: a JSON **object keyed by id** (not an
array) makes `array_size` return NULL — flatten it instead of sizing it.

## Partner side: one record, every place a value lives

Go through our own API client so the request is exactly what production sends. Print every copy
of the value the message is about, so the mismatch (and which copy our code reads) is visible at
once.

```bash
# Rails example; disable boot-time side effects on shared dev data first (see partner.md Step 3).
<APP_FLAG_THAT_DISABLES_BOOT_SIDE_EFFECTS>=1 timeout 120 bin/rails runner '
place = Places::Client.new.place(ARGV[0])
abort "not found" if place.nil?
puts "name:     #{place["name"]}"
puts "address:  #{place["formatted_address"]}"
puts "location: #{place.dig("geometry", "location").values_at("lat", "lng").join(", ")}"
puts "viewport: #{place.dig("geometry", "viewport").to_a.map { |k, v| "#{k}=#{v.values_at("lat", "lng").join(",")}" }.join(" ")}"
' place_8812
```

Check how the client reports failures before reading its output — many return `nil` on a 404
but raise on a 403, and "not in our listing" is often a separate call from "fetch one record".
Without an app client (or for a non-Rails app), `curl` the same endpoint with the key read
through the app's config, never from `.env*`.

## Partner side: a public endpoint, listed

When the partner exposes the data without auth, skip our client:

```bash
curl -s https://api.partner.example/v1/places/place_7720 -o place.json
ruby -rjson -e 'JSON.parse(File.read("place.json"))["opening_hours"]["periods"].each { puts _1.inspect }'
```

`.inspect` makes stray whitespace, case differences and unexpected types (`"7"` vs `7`) visible.
If the endpoint is one their own web app calls rather than their documented API, say so in the
message (partner.md Step 3).
