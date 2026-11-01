#!/usr/bin/env ruby
# frozen_string_literal: true

# Brings an existing sheet up to the current template without touching its content: replaces its
# ?lint self-check script with the template's, and adds any component CSS block it lacks (why
# notes, data table, stack strip, wireframe callouts).
#
# Usage: ruby upgrade_sheet.rb path/to/sheet.html [more sheets...]
template = File.read(File.expand_path("../assets/template.html", __dir__), encoding: "UTF-8")
lint_pattern = %r{<script>\s*// Self-check, read by scripts/render\.rb.*?</script>}m
lint = template[lint_pattern] or abort("template self-check script not found")

# Each component block starts with its comment and runs to the next blank line.
components = {
  ".why {" => %r{/\* why notes:.*?\n\n}m,
  "table.t {" => %r{/\* data table.*?\n\n}m,
  ".stack {" => %r{/\* stack / rollout strip.*?\n\n}m,
  "ol.co {" => %r{/\* wireframe callouts.*?\n(?=\n|</style>)}m
}.transform_values { |pattern| template[pattern] or abort("template block not found: #{pattern.source[0, 30]}") }

abort("usage: ruby upgrade_sheet.rb path/to/sheet.html [...]") if ARGV.empty?
ARGV.each do |path|
  sheet = File.read(path, encoding: "UTF-8")
  sheet.match?(lint_pattern) or abort("#{path}: no self-check script to replace (not built from the template?)")
  sheet = sheet.sub(lint_pattern) { lint }
  added = components.reject { |selector, _| sheet.include?(selector) }
  sheet = sheet.sub("</style>") { "\n" + added.values.join("\n") + "</style>" } if added.any?
  File.write(path, sheet)
  puts "#{path}: lint script synced#{added.any? ? "; added #{added.keys.join(', ')}" : ''}"
end
