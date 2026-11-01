#!/usr/bin/env ruby
# frozen_string_literal: true

# Builds the publishable Claude Artifact page from a one-pager sheet.
#
# The sheet is a full HTML document with a fixed-size .canvas (the PNG source). A published
# Artifact is a fragment (the publisher adds <html>/<head>/<body>) that must fit any viewport
# without horizontal scroll, so this keeps the same sheet and scales the canvas to the width.
#
# Usage: ruby build_artifact.rb path/to/sheet.html   # writes path/to/sheet.artifact.html
sheet = ARGV.first or abort("usage: ruby build_artifact.rb path/to/sheet.html")
source = File.read(sheet, encoding: "UTF-8")

def extract(text, pattern, label)
  match = text.match(pattern) or abort("could not find #{label} in the sheet")
  match[1]
end

title = extract(source, %r{<title>(.*?)</title>}m, "<title>")
head = extract(source, %r{<head>(.*?)</head>}m, "<head>")
style = extract(source, %r{<style>(.*?)</style>}m, "<style>")
body = extract(source, %r{<body>(.*?)</body>}m, "<body>")
width, height = (source[/<meta name="one-pager:size" content="(\d+x\d+)"/, 1] || "1680x1050").split("x").map(&:to_i)
body.include?('id="canvas"') or abort("the sheet has no #canvas wrapper; start from assets/template.html")
# The ?lint self-check only serves render.rb; viewers never pass ?lint, so drop it.
body = body.sub(%r{<script>\s*// Self-check, read by scripts/render\.rb.*?</script>\s*}m, "")
font_links = head.scan(%r{<link [^>]*>}).join("\n")

page = <<~HTML
  <title>#{title}</title>
  <meta name="claude:viewport-fit-sides" content="cover">
  #{font_links}
  <style>#{style}
  /* Artifact wrapper: the fixed canvas scaled to the available width, 16px+ side gutter. */
  body { margin: 0; padding-block: 16px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
  .fit { position: relative; width: 100%; max-width: #{width}px; margin: 0 auto; aspect-ratio: #{width} / #{height}; overflow: hidden; }
  .fit > .canvas { position: absolute; top: 0; left: 0; transform-origin: 0 0; }
  </style>
  <div class="fit" id="fit">
  #{body.strip}
  </div>
  <script>
  (function () {
    var fit = document.getElementById('fit'), canvas = document.getElementById('canvas');
    function scale() { canvas.style.transform = 'scale(' + (fit.clientWidth / #{width}) + ')'; }
    scale();
    if (window.ResizeObserver) new ResizeObserver(scale).observe(fit); else window.addEventListener('resize', scale);
  })();
  </script>
HTML

# The fragment has no <meta charset>, so any non-ASCII character renders as mojibake.
non_ascii = page.chars.select { |char| char.ord > 127 }.uniq
abort("non-ASCII characters would garble in the fragment form; use HTML entities: #{non_ascii.inspect}") if non_ascii.any?

out = sheet.sub(/\.html\z/, ".artifact.html")
File.write(out, page)
puts "wrote #{out} (#{page.bytesize} bytes)"
