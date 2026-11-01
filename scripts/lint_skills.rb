#!/usr/bin/env ruby
# frozen_string_literal: true

# Structural lint for every skill in the repo.
#
#   ruby scripts/lint_skills.rb                      # structure + cross-references
#   ruby scripts/lint_skills.rb --denylist FILE      # also scan for private terms
#   ruby scripts/lint_skills.rb --json               # machine-readable report
#
# The denylist is a private file kept OUTSIDE this repo: one case-insensitive Ruby regex per
# line, `#` comments allowed. A line may be scoped with `path-glob :: regex`.

require "json"
require "yaml"
require "open3"

ROOT = File.expand_path("..", __dir__)
SKILLS_DIR = File.join(ROOT, "plugins", "dev-workflows", "skills")

args = ARGV.dup
json = args.delete("--json")
denylist_path = (i = args.index("--denylist")) ? args.slice!(i, 2).last : nil

skills = Dir.children(SKILLS_DIR).select { |d| File.directory?(File.join(SKILLS_DIR, d)) }.sort
issues = Hash.new { |h, k| h[k] = [] }

def frontmatter(text)
  return nil unless text.start_with?("---\n")

  body = text.split(/^---\s*$/, 3)[1]
  YAML.safe_load(body)
rescue Psych::Exception => e
  { "__error" => e.message }
end

KNOWN_EXTERNAL = %w[code-review simplify security-review artifact-design artifact-capabilities
                    artifact-diagramming dataviz skill-creator loop schedule run init].freeze

skills.each do |name|
  dir = File.join(SKILLS_DIR, name)
  skill_md = File.join(dir, "SKILL.md")
  unless File.exist?(skill_md)
    issues[name] << "missing SKILL.md"
    next
  end

  fm = frontmatter(File.read(skill_md))
  if fm.nil?
    issues[name] << "SKILL.md has no frontmatter"
  elsif fm["__error"]
    issues[name] << "frontmatter YAML error: #{fm['__error']}"
  else
    issues[name] << "frontmatter name '#{fm['name']}' != directory '#{name}'" if fm["name"] != name
    desc = fm["description"].to_s
    issues[name] << "description missing" if desc.empty?
    issues[name] << "description is #{desc.length} chars (> 1024 — may be truncated in listings)" if desc.length > 1024
    raw = File.read(skill_md)[/^description:(.*)$/, 1].to_s.strip
    if !raw.start_with?("'", '"', "|", ">") && raw.include?(" #")
      issues[name] << "unquoted description contains ' #' — YAML silently truncates it at the comment marker"
    end
  end

  Dir.glob(File.join(dir, "**", "*")).select { |f| File.file?(f) }.each do |file|
    rel = file.delete_prefix("#{ROOT}/")
    text = File.read(file, mode: "rb").force_encoding("UTF-8")
    next unless text.valid_encoding?

    # `plugin:skill` references must point at this plugin.
    text.scan(/\b([a-z][a-z0-9-]*):([a-z][a-z0-9-]+)\b/).each do |plugin, skill|
      next unless plugin.end_with?("-tools", "-eng", "-workflows")
      next if plugin == "dev-workflows" && skills.include?(skill)

      issues[name] << "#{rel}: cross-plugin reference #{plugin}:#{skill}"
    end
    # Backticked/bold names that look like skills of ours but don't exist.
    text.scan(/(?:`|\*\*)([a-z][a-z0-9]*(?:-[a-z0-9]+)+)(?:`|\*\*)/).flatten.uniq.each do |ref|
      next if skills.include?(ref) || KNOWN_EXTERNAL.include?(ref)
      next unless ref.match?(/\A(?:[a-z]+-){1,3}(?:review|triage|surgery|stack|create|server|doctor|app|script|intake|debug|probe|doc|explainer|tool|style|sessions|loop|runtime|work|summary|update|message|data|pager|graph|video|bot|team|pr)\z/)

      issues[name] << "#{rel}: references unknown skill `#{ref}`"
    end
  end
end

if denylist_path
  rules = File.readlines(denylist_path, chomp: true).map(&:strip)
              .reject { |l| l.empty? || l.start_with?("#") }
              .map do |l|
                glob, re = l.include?(" :: ") ? l.split(" :: ", 2) : ["**/*", l]
                [glob, Regexp.new(re, Regexp::IGNORECASE)]
              end
  files = Dir.glob(File.join(ROOT, "**", "*"), File::FNM_DOTMATCH)
             .reject { |f| f.include?("/.git/") || File.directory?(f) }
  files.each do |file|
    rel = file.delete_prefix("#{ROOT}/")
    text = File.read(file, mode: "rb").force_encoding("UTF-8").scrub
    text.each_line.with_index(1) do |line, n|
      rules.each do |glob, re|
        next unless File.fnmatch?(glob, rel, File::FNM_PATHNAME | File::FNM_EXTGLOB) || glob == "**/*"
        next unless (m = line.match(re))

        key = rel.start_with?("plugins/dev-workflows/skills/") ? rel.split("/")[3] : "(repo)"
        issues[key] << "LEAK #{rel}:#{n}: /#{re.source}/ matched #{m[0].inspect}"
      end
    end
  end

  # Commit messages are published with the repo too.
  log, = Open3.capture2("git", "-C", ROOT, "log", "--format=%h%x09%B")
  log.each_line do |line|
    rules.each do |_glob, re|
      next unless (m = line.match(re))

      issues["(git log)"] << "LEAK commit message: /#{re.source}/ matched #{m[0].inspect} in #{line.strip[0, 80].inspect}"
    end
  end
end

issues.transform_values!(&:uniq)

if json
  puts JSON.pretty_generate(skills: skills, issues: issues)
else
  puts "#{skills.size} skills"
  issues.each do |k, list|
    puts "\n#{k} (#{list.size})"
    list.first(40).each { |i| puts "  - #{i}" }
    puts "  … #{list.size - 40} more" if list.size > 40
  end
  puts(issues.empty? ? "\nclean" : "\n#{issues.values.sum(&:size)} issue(s)")
end
exit(issues.empty? ? 0 : 1)
