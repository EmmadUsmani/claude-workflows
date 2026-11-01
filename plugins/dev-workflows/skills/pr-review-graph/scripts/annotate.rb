#!/usr/bin/env ruby
# frozen_string_literal: true

# Draws a red highlight box around each node's element on its screenshots, and dims
# the rest of the frame a little so the box reads at thumbnail size. One output per
# (node, screenshot) pair, because two nodes sharing a screenshot point at different
# parts of it. Needs ImageMagick 7 (`magick`).
#
# Spec (JSON):
#   { "source_dir": "~/…/screenshots", "output_dir": "img/a", "max_width": 1280,
#     "shots": [ { "node": "sharedLists", "src": "after/02-shared-lists.png", "boxes": [[x, y, w, h], …] } ] }
# Boxes are in the source PNG's pixels. output_dir is relative to the spec file.
#
# Usage: ruby annotate.rb path/to/annotate.json
#   prints each output path, relative to the spec's directory, for the node's `images[].src`
require "json"
require "fileutils"
require "shellwords"

PAD = 4
spec_path = ARGV.first or abort("usage: ruby annotate.rb annotate.json")
spec = JSON.parse(File.read(spec_path))
spec_dir = File.dirname(File.expand_path(spec_path))
source_dir = File.expand_path(spec.fetch("source_dir"), spec_dir)
output_dir = File.expand_path(spec.fetch("output_dir", "img/a"), spec_dir)
max_width = spec.fetch("max_width", 1280)
system("magick", "-version", out: File::NULL) or abort("ImageMagick 7 (`magick`) is required")
FileUtils.mkdir_p(output_dir)

def dimensions(path)
  `magick identify -format "%w %h" #{path.shellescape}`.split.map(&:to_i)
end

spec.fetch("shots").each do |shot|
  input = File.join(source_dir, shot.fetch("src"))
  abort("missing screenshot #{input}") unless File.file?(input)
  parts = shot["src"].sub(/\.[a-z]+\z/i, "").split("/")
  output = File.join(output_dir, "#{shot.fetch('node')}__#{parts.join('-')}.webp")
  width, height = dimensions(input)
  stroke = width < 600 ? 3 : 4
  boxes = shot.fetch("boxes").map do |x, y, w, h|
    abort("box #{[x, y, w, h].inspect} is outside #{shot['src']} (#{width}x#{height})") if x >= width || y >= height
    [[x - PAD, 0].max, [y - PAD, 0].max, [x + w + PAD, width - 1].min, [y + h + PAD, height - 1].min]
  end
  # Even-odd fill: the whole frame minus each box, so only the outside is dimmed.
  holes = boxes.map { |x0, y0, x1, y1| "M #{x0},#{y0} L #{x0},#{y1} L #{x1},#{y1} L #{x1},#{y0} Z" }.join(" ")
  dim = "fill-rule evenodd path 'M 0,0 L #{width},0 L #{width},#{height} L 0,#{height} Z #{holes}'"
  rings = boxes.map { |x0, y0, x1, y1| "roundrectangle #{x0},#{y0} #{x1},#{y1} 8,8" }
  command = ["magick", input,
    "-fill", "rgba(15,17,21,0.32)", "-stroke", "none", "-draw", dim,
    "-fill", "none", "-stroke", "rgba(255,59,48,0.35)", "-strokewidth", (stroke + 6).to_s, *rings.flat_map { |ring| ["-draw", ring] },
    "-stroke", "#FF3B30", "-strokewidth", stroke.to_s, *rings.flat_map { |ring| ["-draw", ring] }]
  command += ["-resize", "#{max_width}x"] if width > max_width
  command += ["-quality", "82", output]
  system(*command, exception: true)
  puts output.delete_prefix("#{spec_dir}/")
end
