#!/usr/bin/env ruby
# frozen_string_literal: true

# Starts a one-pager sheet from assets/template.html with the header block for the mode.
#
# Usage:
#   ruby new_sheet.rb <sandbox_dir>/tickets/<topic>/one-pager/<slug>-one-pager.html --mode new
#   ruby new_sheet.rb <dest>.html --mode revision
#
# Refuses to overwrite an existing file: iterate on the sheet you already have.
require "fileutils"
require "optparse"

mode = nil
OptionParser.new { |parser| parser.on("--mode MODE", %w[new revision]) { |value| mode = value } }.parse!
dest = ARGV.first or abort("usage: ruby new_sheet.rb <dest>.html --mode new|revision")
mode or abort("pass --mode new or --mode revision (say which you inferred, and why)")
dest = File.expand_path(dest)
abort("#{dest} already exists; edit it instead of starting over") if File.exist?(dest)

template = File.read(File.expand_path("../assets/template.html", __dir__), encoding: "UTF-8")
revision_block = template[%r{      <!-- REVISION MODE:.*?\n      <div class="rev">.*?\n      </div>\n}m] or abort("template revision block not found")
new_block = template[%r{      <!-- NEW MODE: use this instead of \.rev\.\n(.*?)      -->\n}m, 1] or abort("template new-mode block not found")
status_note = "      <!-- NEW MODE: .status block. Revision mode would use the .rev table instead (see REFERENCE.md). -->\n"

sheet =
  if mode == "new"
    template
      .sub(revision_block, status_note + new_block)
      .sub(%r{      <!-- NEW MODE: use this instead of \.rev\.\n.*?      -->\n}m, "")
      .sub(%(<span class="v sig">B &middot; PROPOSED</span>), %(<span class="v sig">A &middot; PROPOSED</span>))
  else
    template.sub(%r{      <!-- NEW MODE: use this instead of \.rev\.\n.*?      -->\n}m, "")
  end

FileUtils.mkdir_p(File.dirname(dest))
File.write(dest, sheet)
puts "wrote #{dest} (#{mode} mode). Replace every REPLACE, then: ruby #{File.join(__dir__, 'render.rb')} #{dest}"
