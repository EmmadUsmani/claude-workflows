#!/usr/bin/env ruby
# frozen_string_literal: true

# Starts a review-graph data file from the PR's real metadata, so the header, links and
# line counts are never hand-typed. Fill in lanes, nodes, edges and code next (SKILL.md Phase 2-4).
#
# Usage: ruby scaffold.rb <owner/repo> <pr-number> <out-dir>
#   writes <out-dir>/pr<number>.data.json and prints the changed files with their +/- counts
require "json"
require "fileutils"

repo, number, out_dir = ARGV
abort("usage: ruby scaffold.rb <owner/repo> <pr-number> <out-dir>") unless repo && number && out_dir
fields = "number,title,state,author,headRefName,baseRefName,headRefOid,baseRefOid,additions,deletions,changedFiles,commits,files,mergedAt,url"
raw = `gh pr view #{number} --repo #{repo} --json #{fields}`
abort("gh pr view failed") unless $?.success?
pr = JSON.parse(raw)

data = {
  "pr" => {
    "repo" => repo, "number" => pr["number"], "title" => pr["title"],
    "state" => pr["mergedAt"] ? "merged" : pr["state"].downcase,
    "author" => pr.dig("author", "login"), "headRef" => pr["headRefName"], "baseRef" => pr["baseRefName"],
    "headSha" => pr["headRefOid"], "baseSha" => pr["baseRefOid"],
    "additions" => pr["additions"], "deletions" => pr["deletions"],
    "files" => pr["changedFiles"], "commits" => pr["commits"].size
  },
  "summary" => "",
  "note" => "Code read at head #{pr['headRefOid'][0, 10]}.",
  "contextLabel" => "Context",
  "lanes" => [],
  "boundaries" => [],
  "stack" => [],
  "modeNotes" => { "before" => "", "after" => "" },
  "nodes" => [],
  "edges" => [],
  "findings" => [],
  "order" => [],
  "code" => {}
}
FileUtils.mkdir_p(out_dir)
path = File.join(out_dir, "pr#{number}.data.json")
abort("#{path} exists; not overwriting") if File.exist?(path)
File.write(path, JSON.pretty_generate(data) + "\n")
puts "wrote #{path}"
puts "base #{pr['baseRefName']} (not main: review against it)" unless pr["baseRefName"] == "main"
# Not nodes (SKILL.md Phase 1): generated output, lockfiles, docs. Listed so the `note` can name them.
# Extend per repo when it has its own generated outputs (a codegen directory, a schema dump).
SKIP = [
  [/(\A|\/)(structure\.sql|schema\.rb|schema\.graphql|.*\.lock|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|go\.sum)\z/, "generated"],
  [/(\A|\/)__generated__\/|\.generated\.\w+\z|\.pb\.go\z|_pb2\.pyi?\z/, "generated"],
  [/__snapshots__\/|\.snap\z/, "generated"],
  [/\A(docs?|manual)\/|\.md\z|(\A|\/)CHANGELOG/i, "docs"]
].freeze
pr["files"].each do |file|
  tag = SKIP.find { |pattern, _| file["path"].match?(pattern) }&.last
  puts format("%6s %6s  %-10s %s", "+#{file['additions']}", "-#{file['deletions']}", tag ? "[#{tag}]" : "", file["path"])
end
