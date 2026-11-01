#!/usr/bin/env ruby
# frozen_string_literal: true

# Checks that SETTINGS.md's "Used by" column matches which skills reference each `<key>`.
#   ruby scripts/settings_usage.rb          # print the computed mapping
#   ruby scripts/settings_usage.rb --check  # exit 1 when SETTINGS.md is out of date
#   ruby scripts/settings_usage.rb --write  # rewrite the column

ROOT = File.expand_path("../plugins/dev-workflows", __dir__)
settings = File.read(File.join(ROOT, "SETTINGS.md"))
skills = Dir.children(File.join(ROOT, "skills")).sort
files = skills.to_h { |s| [s, Dir.glob(File.join(ROOT, "skills", s, "**", "*")).select { File.file?(_1) }.map { File.read(_1, mode: "rb") }.join] }

rows = settings.scan(/^\| `([a-z_]+)` \| .*? \| .*? \| (.*?) \|$/)
stale = []
rows.each do |key, listed|
  used = skills.select { |s| files[s].include?("<#{key}>") }
  computed = used.empty? ? "—" : used.join(", ")
  puts format("%-20s %s", key, computed) unless ARGV.include?("--check")
  stale << key if computed != listed.strip
end

if ARGV.include?("--write")
  updated = settings.gsub(/^(\| `([a-z_]+)` \| .*? \| .*? \| )(.*?)( \|)$/) do
    key = Regexp.last_match(2)
    used = skills.select { |s| files[s].include?("<#{key}>") }
    "#{Regexp.last_match(1)}#{used.empty? ? '—' : used.join(', ')}#{Regexp.last_match(4)}"
  end
  File.write(File.join(ROOT, "SETTINGS.md"), updated)
  puts "SETTINGS.md Used by rewritten (#{rows.size} keys)"
elsif ARGV.include?("--check")
  abort("SETTINGS.md Used by is stale for: #{stale.join(', ')}") unless stale.empty?
  puts "SETTINGS.md Used by is current (#{rows.size} keys)"
end
