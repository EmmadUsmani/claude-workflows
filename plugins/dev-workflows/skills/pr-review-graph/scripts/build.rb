#!/usr/bin/env ruby
# frozen_string_literal: true

# Builds the review-graph page from a data file (REFERENCE.md §2 is the schema).
#
# Lays out any node without explicit x/y from its lane and row, validates every
# reference (edges, findings, code excerpts, screenshots, review order), writes the
# page beside the data file, and prints the `files` list the Artifact publish needs.
#
# Usage:
#   ruby build.rb graph.data.json                   # writes <dir>/<slug>.html
#   ruby build.rb graph.data.json --out x.html
#   ruby build.rb graph.data.json --check           # validate only
#   ruby build.rb graph.data.json --optimize-rows   # re-row lane-placed nodes to cut edges
#                                                    # hidden under cards; saves rows to the data file
require "json"
require "pathname"

LANE_WIDTH = 300
ROW_HEIGHT = 160
NODE_W = 232
NODE_H = 120
NODE_KINDS = %w[added modified behavior removed unchanged context].freeze
EDGE_KINDS = %w[added removed modified impacted unchanged context].freeze
RELATIONS = %w[render nav call use net resolve read write async test].freeze
SEVERITIES = %w[high med low nit].freeze
REVIEWABLE = %w[added modified behavior removed].freeze

# Same cubic the page draws (template geom()): side to side across lanes, top/bottom within one.
def curve(sx0, sy0, tx0, ty0)
  if tx0 >= sx0 + NODE_W - 10
    sx, sy, tx, ty = sx0 + NODE_W, sy0 + NODE_H / 2.0, tx0, ty0 + NODE_H / 2.0
    dx = [60, (tx - sx) * 0.5].max
    [[sx, sy], [sx + dx, sy], [tx - dx, ty], [tx, ty]]
  elsif tx0 + NODE_W <= sx0 + 10
    sx, sy, tx, ty = sx0, sy0 + NODE_H / 2.0, tx0 + NODE_W, ty0 + NODE_H / 2.0
    dx = [60, (sx - tx) * 0.5].max
    [[sx, sy], [sx - dx, sy], [tx + dx, ty], [tx, ty]]
  else
    down = ty0 > sy0
    sx, sy = sx0 + NODE_W / 2.0, down ? sy0 + NODE_H : sy0
    tx, ty = tx0 + NODE_W / 2.0, down ? ty0 : ty0 + NODE_H
    dy = [50, (ty - sy).abs * 0.5].max * (down ? 1 : -1)
    [[sx, sy], [sx, sy + dy], [tx, ty - dy], [tx, ty]]
  end
end

def point(points, t)
  u = 1 - t
  weights = [u**3, 3 * u * u * t, 3 * u * t * t, t**3]
  [0, 1].map { |axis| points.each_with_index.sum { |pt, index| pt[axis] * weights[index] } }
end

# The card an edge runs under, if any: xy is {id => [x, y]}.
def hidden_under(edge, xy)
  from = xy[edge["from"]]
  to = xy[edge["to"]]
  return nil unless from && to
  points = curve(*from, *to)
  samples = (1..15).map { |step| point(points, step / 16.0) }
  min_x, max_x = samples.map(&:first).minmax
  min_y, max_y = samples.map(&:last).minmax
  xy.find do |id, (x, y)|
    next false if id == edge["from"] || id == edge["to"]
    next false if x + NODE_W < min_x || x > max_x || y + NODE_H < min_y || y > max_y
    samples.any? { |px, py| px > x + 6 && px < x + NODE_W - 6 && py > y + 6 && py < y + NODE_H - 6 }
  end&.first
end

def layout_cost(rows, lane_of, fixed, edges)
  xy = fixed.merge(rows.to_h { |id, row| [id, [lane_of[id] * LANE_WIDTH, row * ROW_HEIGHT]] })
  edges.sum do |edge|
    weight = edge["rel"] == "test" ? 1 : 3
    (hidden_under(edge, xy) ? weight : 0) + 0.05 * ((rows[edge["from"]] || 0) - (rows[edge["to"]] || 0)).abs
  end
end

data_path = ARGV.find { |arg| !arg.start_with?("--") && !ARGV[ARGV.index(arg) - 1].to_s.start_with?("--out") } or
  abort("usage: ruby build.rb graph.data.json [--out page.html] [--check] [--optimize-rows]")
check_only = ARGV.include?("--check")
optimize = ARGV.include?("--optimize-rows")
out_index = ARGV.index("--out")
data = JSON.parse(File.read(data_path, encoding: "UTF-8"))
data_dir = Pathname.new(File.dirname(File.expand_path(data_path)))
pr = data.fetch("pr") { abort("data has no `pr` block") }
slug = data["slug"] || "pr#{pr['number']}-review-graph"
out_path = out_index ? File.expand_path(ARGV[out_index + 1]) : data_dir.join("#{slug}.html").to_s
page_dir = Pathname.new(File.dirname(out_path))

errors = []
warnings = []
lanes = data["lanes"] || []
lane_index = lanes.each_with_index.each_with_object({}) do |(lane, index), map|
  map[index] = index
  map[lane["id"]] = index if lane["id"]
end
errors << "no lanes" if lanes.empty?
nodes = data["nodes"] || []
edges = data["edges"] || []
ids = nodes.map { |node| node["id"] }
errors << "duplicate node ids: #{ids.tally.select { |_, count| count > 1 }.keys.join(', ')}" if ids.uniq.size != ids.size

# ---------- layout ----------
lane_placed = nodes.select { |node| node["x"].nil? || node["y"].nil? }
lane_of = {}
rows = {}
next_row = Hash.new(0)
lane_placed.each do |node|
  lane = lane_index[node["lane"]]
  next errors << "node #{node['id']}: lane #{node['lane'].inspect} is not a lane id or index" if lane.nil?
  lane_of[node["id"]] = lane
  rows[node["id"]] = node["row"] || next_row[lane]
  next_row[lane] = [next_row[lane], rows[node["id"]].ceil + 1].max
end
fixed = (nodes - lane_placed).to_h { |node| [node["id"], [node["x"], node["y"]]] }

if optimize && errors.empty?
  max_row = [rows.values.max.to_i, next_row.values.max.to_i].max + 2
  best = layout_cost(rows, lane_of, fixed, edges)
  before = best
  random = Random.new(pr["number"].to_i)
  (rows.size * 60).times do
    id = rows.keys.sample(random: random)
    candidate = rows.dup
    target = random.rand(0..max_row)
    occupant = candidate.find { |other, row| other != id && lane_of[other] == lane_of[id] && (row - target).abs < 1 }&.first
    candidate[occupant] = candidate[id] if occupant
    candidate[id] = target
    score = layout_cost(candidate, lane_of, fixed, edges)
    next unless score < best
    best = score
    rows = candidate
  end
  # Close the gaps the search left at the top of each lane, keeping relative order.
  top = rows.values.min.to_f
  rows.transform_values! { |row| row - top }
  lane_placed.each { |node| node["row"] = rows[node["id"]] if rows.key?(node["id"]) }
  saved = JSON.parse(File.read(data_path, encoding: "UTF-8"))
  saved["nodes"].each { |node| node["row"] = rows[node["id"]] if rows.key?(node["id"]) }
  File.write(data_path, JSON.pretty_generate(saved) + "\n")
  puts format("optimize-rows: layout cost %.1f -> %.1f; rows saved to %s", before, best, data_path)
end
lane_placed.each do |node|
  next unless lane_of.key?(node["id"])
  node["x"] = lane_of[node["id"]] * LANE_WIDTH
  node["y"] = (rows[node["id"]] * ROW_HEIGHT).round
end

# ---------- nodes ----------
long_names = []
nodes.each do |node|
  label = node["id"] || node["name"]
  %w[id type name sub kind].each { |key| errors << "node #{label}: missing #{key}" if node[key].to_s.empty? }
  errors << "node #{label}: unknown kind #{node['kind'].inspect}" unless NODE_KINDS.include?(node["kind"])
  warnings << "node #{label}: more than 2 bullets; the card shows two" if (node["bullets"] || []).size > 2
  (node["bullets"] || []).each { |bullet| warnings << "node #{label}: bullet over 45 chars is cut off: #{bullet[0, 50].inspect}" if bullet.length > 45 }
  long_names << node["id"] if node["name"].to_s.length > 24
  warnings << "node #{label}: no summary" if node["summary"].to_s.empty? && node["kind"] != "context"
  warnings << "node #{label}: changed node with no code excerpt" if REVIEWABLE.include?(node["kind"]) && node["code"].nil?
  (node["images"] || []).each do |image|
    image_path = page_dir.join(image["src"].to_s)
    errors << "node #{label}: image #{image['src']} not found at #{image_path}" unless image_path.file?
  end
end
by_id = nodes.to_h { |node| [node["id"], node] }

code = data["code"] || {}
nodes.each { |node| errors << "node #{node['id']}: code #{node['code'].inspect} not in `code`" if node["code"] && !code.key?(node["code"]) }
code.each do |key, lines|
  next errors << "code #{key}: must be an array of lines" unless lines.is_a?(Array)
  warnings << "code #{key}: #{lines.size} lines; keep excerpts under ~60" if lines.size > 60
  bad = lines.reject { |line| line.empty? || "+- @".include?(line[0]) }
  errors << "code #{key}: lines must start with +, -, space or @ (#{bad.first.inspect})" if bad.any?
end

# ---------- edges ----------
edge_ids = edges.map { |edge| edge["id"] }
errors << "duplicate edge ids" if edge_ids.uniq.size != edge_ids.size
edges.each do |edge|
  label = edge["id"] || "#{edge['from']}->#{edge['to']}"
  errors << "edge #{label}: unknown from #{edge['from'].inspect}" unless by_id[edge["from"]]
  errors << "edge #{label}: unknown to #{edge['to'].inspect}" unless by_id[edge["to"]]
  errors << "edge #{label}: unknown rel #{edge['rel'].inspect}" unless RELATIONS.include?(edge["rel"])
  errors << "edge #{label}: unknown kind #{edge['kind'].inspect}" unless EDGE_KINDS.include?(edge["kind"])
  errors << "edge #{label}: code #{edge['code'].inspect} not in `code`" if edge["code"] && !code.key?(edge["code"])
  warnings << "edge #{label}: changed edge with no detail" if %w[added removed modified impacted].include?(edge["kind"]) && edge["rel"] != "test" && edge["detail"].to_s.empty?
  warnings << "edge #{label}: label over 32 chars (fine if it's a verbatim identifier)" if edge["label"].to_s.length > 32
end
pairs = edges.map { |edge| [edge["from"], edge["to"], edge["rel"]] }
warnings << "duplicate edges: #{pairs.tally.select { |_, count| count > 1 }.keys.map { |pair| pair.join('->') }.join(', ')}" if pairs.uniq.size != pairs.size
connected = edges.flat_map { |edge| [edge["from"], edge["to"]] }.uniq
(ids - connected).each { |id| warnings << "node #{id}: no edges" }

# ---------- findings, order, boundaries ----------
findings = data["findings"] || []
findings.each do |finding|
  errors << "finding #{finding['id']}: unknown node #{finding['node'].inspect}" unless by_id[finding["node"]]
  errors << "finding #{finding['id']}: unknown sev #{finding['sev'].inspect}" unless SEVERITIES.include?(finding["sev"])
  (finding["alsoNodes"] || []).each { |id| errors << "finding #{finding['id']}: unknown alsoNodes #{id}" unless by_id[id] }
end
(data["order"] || []).each { |id| errors << "order: unknown node #{id}" unless by_id[id] }
(data["boundaries"] || []).each { |boundary| errors << "boundary after lane #{boundary['afterLane']} is out of range" unless boundary["afterLane"].to_i.between?(0, lanes.size - 2) }

# ---------- layout checks ----------
if errors.empty?
  xy = nodes.to_h { |node| [node["id"], [node["x"], node["y"]]] }
  crossings = edges.filter_map do |edge|
    under = hidden_under(edge, xy)
    "#{edge['id']} (#{edge['from']}->#{edge['to']} under #{under})" if under
  end
  nodes.combination(2).each do |a, b|
    warnings << "nodes #{a['id']} and #{b['id']} overlap at (#{a['x']},#{a['y']})" if (a["x"] - b["x"]).abs < NODE_W && (a["y"] - b["y"]).abs < NODE_H
  end
  warnings << "#{crossings.size} edge(s) run under another card (try --optimize-rows, or move a node): #{crossings.join(', ')}" if crossings.any?

  # The page places each label at the first free spot along its edge (template renderGraph());
  # when none is free it falls back to the midpoint, on top of whatever is there.
  boxes = xy.values.map { |x, y| [x - 4, y - 4, NODE_W + 8, NODE_H + 8] }
  placed = []
  stuck = []
  edges.each do |edge|
    next if edge["label"].to_s.empty?
    points = curve(*xy[edge["from"]], *xy[edge["to"]])
    width = (edge["label"].length * 6.2 + 22).round
    overlaps = ->(rect) { (boxes + placed).any? { |bx, by, bw, bh| rect[0] < bx + bw && rect[0] + rect[2] > bx && rect[1] < by + bh && rect[1] + rect[3] > by } }
    spot = [0.5, 0.42, 0.58, 0.34, 0.66, 0.27, 0.73, 0.2, 0.8].map { |t| px, py = point(points, t); [px - width / 2.0, py - 12, width, 24] }.find { |rect| !overlaps.call(rect) }
    px, py = point(points, 0.5)
    fallback = [px - width / 2.0, py - 12, width, 24]
    # Only a label over a card's chip and name (its top 56px) costs the reader anything.
    covered = !spot && xy.find do |id, (x, y)|
      next false if id == edge["from"] || id == edge["to"]
      fallback[0] < x + NODE_W && fallback[0] + width > x && fallback[1] < y + 56 && fallback[1] + 24 > y
    end
    stuck << "#{edge['id']} (over #{covered.first})" if covered
    placed << (spot || fallback)
  end
  warnings << "#{stuck.size} edge label(s) will sit on another card's name (shorten them or move a node): #{stuck.join(', ')}" if stuck.any?
end
warnings << "#{long_names.size} name(s) over 24 chars are cut off on their cards (put the class in `sub`, the method in `name`): #{long_names.join(', ')}" if long_names.any?

warnings.each { |warning| warn "warning: #{warning}" }
unless errors.empty?
  errors.each { |error| warn "error: #{error}" }
  abort "#{errors.size} error(s); nothing written"
end
puts "ok: #{nodes.size} nodes, #{edges.size} edges, #{findings.size} findings, #{code.size} code excerpts, #{warnings.size} warning(s)"
exit if check_only

template = File.read(File.expand_path("../assets/template.html", __dir__), encoding: "UTF-8")
json = JSON.generate(data).gsub("</", "<\\/")
title = data["title"] || "##{pr['number']} Review Graph"
page = template.sub("__TITLE__") { title.gsub("&", "&amp;").gsub("<", "&lt;") }.sub("__DATA__") { json }
File.write(out_path, page)
images = nodes.flat_map { |node| (node["images"] || []).map { |image| image["src"] } }.uniq.sort
puts "wrote #{out_path} (#{page.bytesize} bytes)"
puts "publish: file_path=#{out_path} root=#{page_dir}"
puts "files: #{JSON.generate(images)}"
