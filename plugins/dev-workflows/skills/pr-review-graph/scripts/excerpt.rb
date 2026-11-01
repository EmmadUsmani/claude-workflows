#!/usr/bin/env ruby
# frozen_string_literal: true

# Cuts verbatim, diff-marked code excerpts for the data file's `code` block, so no excerpt is
# ever hand-copied. Ranges are new-file line numbers; removed lines that sit inside a range are
# kept in place (marked `-`). A file the PR didn't touch comes out as plain context; a file the PR
# deleted takes old-file numbers (`"old": true`).
#
# Spec (JSON): { "c-formPairs": [ { "path": "lib/rack/request.rb", "from": 597, "to": 606, "label": "request.rb" } ] }
# (`[path, from, to]` arrays work too; `label` defaults to the path.)
#
# Usage:
#   ruby excerpt.rb <repo dir> <base sha> <head sha> excerpts.json                      # prints {key: [lines]}
#   ruby excerpt.rb <repo dir> <base sha> <head sha> excerpts.json --into graph.data.json  # merges into `code`
require "json"
require "open3"

repo, base, head, spec_path = ARGV
abort("usage: ruby excerpt.rb <repo> <base> <head> excerpts.json [--into data.json]") unless repo && base && head && spec_path
into_index = ARGV.index("--into")
spec = JSON.parse(File.read(spec_path))

def git(repo, *args)
  out, status = Open3.capture2("git", "-C", repo, *args)
  abort("git #{args.join(' ')} failed") unless status.success?
  out
end

# Every line of the file as [marker, text, new_number, old_number], in diff order.
def annotated(repo, base, head, path)
  diff = git(repo, "diff", "-U99999", "#{base}...#{head}", "--", path)
  if diff.empty?
    return git(repo, "show", "#{head}:#{path}").lines.each_with_index.map { |line, index| [" ", line.chomp, index + 1, index + 1] }
  end
  new_number = old_number = 0
  diff.lines.drop_while { |line| !line.start_with?("@@") }.each_with_object([]) do |line, rows|
    if (match = line.match(/\A@@ -(\d+)(?:,\d+)? \+(\d+)/))
      old_number = match[1].to_i - 1
      new_number = match[2].to_i - 1
    elsif line.start_with?("+")
      rows << ["+", line[1..].chomp, new_number += 1, nil]
    elsif line.start_with?("-")
      rows << ["-", line[1..].chomp, nil, old_number += 1]
    elsif line.start_with?(" ")
      rows << [" ", line[1..].chomp, new_number += 1, old_number += 1]
    end
  end
end

cache = {}
code = spec.to_h do |key, ranges|
  lines = ranges.flat_map do |range|
    range = { "path" => range[0], "from" => range[1], "to" => range[2] } if range.is_a?(Array)
    rows = cache[range["path"]] ||= annotated(repo, base, head, range["path"])
    column = range["old"] ? 3 : 2
    first = rows.index { |row| row[column] && row[column] >= range["from"] }
    last = rows.rindex { |row| row[column] && row[column] <= range["to"] }
    abort("#{key}: #{range['path']} has no lines #{range['from']}-#{range['to']}") unless first && last && first <= last
    ["@ #{range['label'] || range['path']}:#{range['from']}"] + rows[first..last].map { |marker, text| "#{marker}#{text}" }
  end
  warn "#{key}: #{lines.size} lines (keep excerpts under ~60)" if lines.size > 60
  [key, lines]
end

if into_index
  data_path = ARGV[into_index + 1]
  data = JSON.parse(File.read(data_path))
  data["code"] = (data["code"] || {}).merge(code)
  File.write(data_path, JSON.pretty_generate(data) + "\n")
  puts "merged #{code.size} excerpt(s) into #{data_path}"
else
  puts JSON.pretty_generate(code)
end
