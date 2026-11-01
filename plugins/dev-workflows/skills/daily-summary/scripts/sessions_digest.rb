#!/usr/bin/env ruby
# Digest of the user's local Claude Code sessions for one local-time day.
#
#   ruby sessions_digest.rb [YYYY-MM-DD] [--from HH:MM] [--exclude ID[,ID]] [--prompt-chars N] [--reply-chars N]
#                           [--tz Area/City] [--projects-dir DIR]
#   ruby sessions_digest.rb [YYYY-MM-DD] --session ID [--from HH:MM]   # drill into one session
#
# Reads <projects-dir>/*/*.jsonl (default ~/.claude/projects; main transcripts only — subagent
# transcripts are skipped, their reports land in the parent session). Only records timestamped
# inside the day count, because one session often spans several days, and a /resume keeps
# appending to the original file under the original session id. Read-only.
#
# The day is midnight → midnight in --tz, else $TZ, else the system's local zone.

require "json"
require "time"
require "date"

args = ARGV.dup
opt = ->(flag, default) { (i = args.index(flag)) ? args.slice!(i, 2).last : default }
if args.delete("--help") || args.delete("-h")
  puts File.readlines(__FILE__).drop(1).take_while { _1.start_with?("#") }.map { _1.sub(/\A# ?/, "") }
  exit
end
tz = opt.("--tz", nil)
ENV["TZ"] = tz if tz
projects_dir = File.expand_path(opt.("--projects-dir", ENV.fetch("CLAUDE_PROJECTS_DIR", "~/.claude/projects")))
exclude = opt.("--exclude", "").split(",")
drill = opt.("--session", nil)
from = opt.("--from", nil)
prompt_chars = opt.("--prompt-chars", drill ? "4000" : "500").to_i
reply_chars = opt.("--reply-chars", drill ? "4000" : "700").to_i
date = args.first ? Date.parse(args.first) : Date.today
day_start = Time.local(date.year, date.month, date.day)
day_start = Time.local(date.year, date.month, date.day, *from.split(":").map(&:to_i)) if from
next_day = date + 1
day_end = Time.local(next_day.year, next_day.month, next_day.day) # DST-safe: not +86_400
zone = ENV["TZ"] || Time.local(date.year, date.month, date.day).zone

TICK = /\A(No change|No new|Still (waiting|running|no)|Nothing new|Quiet)\b|\bno change\b|green and quiet/i
OUTCOME = /\b(merged|opened|created|applied|published|republished|posted|deployed|live in prod|ready for review|confirmed)\b/i

def clean(text)
  text.gsub(%r{<system-reminder>.*?</system-reminder>}m, "")
      .gsub(%r{</?pasted_content[^>]*>}, "")
      .gsub(/\s+/, " ").strip
end

def texts(content)
  return [content] if content.is_a?(String)
  Array(content).select { |b| b["type"] == "text" }.map { |b| b["text"] }
end

def truncate(text, n) = text.length > n ? "#{text[0, n]}…" : text

def near_dup?(a, b) = a && b && (a.start_with?(b[0, 120]) || b.start_with?(a[0, 120]))

files = Dir.glob(File.join(projects_dir, "*", "*.jsonl")).select { |f| File.mtime(f) >= day_start }
files.select! { |f| File.basename(f, ".jsonl").start_with?(drill) } if drill
files.reject! { |f| exclude.any? { |id| File.basename(f, ".jsonl").start_with?(id) } }

digests = files.filter_map do |file|
  title = nil
  cwds = []
  branches = []
  prompts = []
  commands = []
  replies = []
  skills = []
  mcp = []
  prs = []
  stamps = []
  ticks = 0

  File.foreach(file) do |line|
    rec = JSON.parse(line) rescue next
    title = rec["customTitle"] if rec["type"] == "custom-title"
    ts = rec["timestamp"] && (Time.parse(rec["timestamp"]).localtime rescue nil)
    next unless ts && ts >= day_start && ts < day_end
    next if rec["isSidechain"]

    cwds << rec["cwd"] if rec["cwd"]
    branches << rec["gitBranch"] if rec["gitBranch"] && rec["gitBranch"] != "HEAD"

    case rec["type"]
    when "pr-link"
      prs << rec["prUrl"]
    when "user"
      next if rec["isMeta"]
      texts(rec.dig("message", "content")).each do |t|
        if (cmd = t[%r{<command-name>(.*?)</command-name>}, 1])
          commands << [cmd, t[%r{<command-args>(.*?)</command-args>}m, 1].to_s.strip].reject(&:empty?).join(" ")
          stamps << ts
          next
        end
        if (bash = t[%r{<bash-input>(.*?)</bash-input>}m, 1])
          prompts << "#{ts.strftime('%H:%M')} ran: #{truncate(bash.strip, prompt_chars)}"
          stamps << ts
          next
        end
        next if t.start_with?("[Request interrupted") || t.include?("<local-command-stdout>") || t.include?("<bash-stdout>")
        next if t.lstrip.start_with?("<task-notification>", "<teammate-message", "<agent-message")
        c = clean(t)
        next if c.empty?
        stamps << ts
        prev = prompts.last&.sub(/\A\d\d:\d\d /, "")
        next if near_dup?(prev, c)
        prompts << "#{ts.strftime('%H:%M')} #{truncate(c, prompt_chars)}"
      end
    when "assistant"
      Array(rec.dig("message", "content")).each do |b|
        if b["type"] == "tool_use"
          skills << b.dig("input", "skill") if b["name"] == "Skill"
          # MCP servers are often used without loading a skill (a warehouse query, a chat
          # search), so the server name itself marks what the session touched.
          mcp << b["name"].split("__")[1] if b["name"].to_s.start_with?("mcp__")
        end
        next unless b["type"] == "text" && !b["text"].strip.empty?
        c = clean(b["text"])
        stamps << ts
        if c.length < 200 && c.match?(TICK)
          ticks += 1
        else
          replies << "#{ts.strftime('%H:%M')} #{truncate(c, reply_chars)}"
        end
      end
    end
  end

  next if prompts.empty? && commands.empty? && replies.empty?

  {
    id: File.basename(file, ".jsonl"), title:, cwds: cwds.uniq, branches: branches.uniq,
    first: stamps.min, last: stamps.max, ticks:,
    prompts:, commands: commands.uniq, skills: skills.compact.tally, mcp: mcp.compact.tally,
    prs: prs.uniq, replies: drill ? replies : (replies.grep(OUTCOME).last(8) | replies.last(3)).sort
  }
end

tally = ->(h) { h.map { |k, v| v > 1 ? "#{k} ×#{v}" : k }.join(", ") }

puts "# Claude Code sessions — #{date} (#{date.strftime('%A')}, #{zone})#{from ? " from #{from}" : ''}"
puts "#{digests.size} session(s) with activity#{exclude.any? ? " (excluding #{exclude.join(', ')})" : ''}"
digests.sort_by { |d| d[:first] }.each do |d|
  puts
  puts "## #{d[:title] || '(untitled)'} — #{d[:first].strftime('%H:%M')}–#{d[:last].strftime('%H:%M')}"
  puts "- session: #{d[:id]}"
  puts "- cwd: #{d[:cwds].join(', ')}#{d[:branches].any? ? " (branches: #{d[:branches].join(', ')})" : ''}"
  puts "- slash commands: #{d[:commands].join('; ')}" if d[:commands].any?
  puts "- skills: #{tally.(d[:skills])}" if d[:skills].any?
  puts "- MCP servers used: #{tally.(d[:mcp])}" if d[:mcp].any?
  puts "- PRs associated (confirm with gh — may be from an earlier day): #{d[:prs].join(' ')}" if d[:prs].any?
  if d[:prompts].any?
    puts "- user prompts:"
    d[:prompts].each { |p| puts "    - #{p}" }
  elsif d[:commands].empty?
    puts "- no prompts from the user today (automated/cron-driven activity only)"
  end
  if d[:replies].any?
    puts "- #{drill ? 'assistant replies' : 'outcome + last assistant replies'}:"
    d[:replies].each { |r| puts "    - #{r}" }
  end
  puts "- cron/poll ticks with no change: #{d[:ticks]}" if d[:ticks].positive?
end
