#!/usr/bin/env ruby
# frozen_string_literal: true

# Renders a one-pager sheet to PNG with headless Chrome, after running the sheet's own
# self-check (the ?lint script in assets/template.html).
#
# Usage:
#   ruby render.rb path/to/sheet.html                 # lint + PNG beside the HTML (2x)
#   ruby render.rb path/to/sheet.html --out x.png     # choose the PNG path
#   ruby render.rb path/to/sheet.html --scale 1       # 1x instead of 2x
#   ruby render.rb path/to/sheet.html --lint-only     # report issues, no PNG
#
# Exit status: 0 = clean, 1 = lint issues found (the PNG is still written, so you can look),
# 2 = could not render. Set CHROME_BIN to override the browser.
require "json"
require "open3"
require "optparse"
require "tmpdir"
require "tempfile"

options = { scale: 2, lint_only: false, out: nil }
OptionParser.new do |parser|
  parser.on("--out PATH") { |value| options[:out] = value }
  parser.on("--scale N", Float) { |value| options[:scale] = value }
  parser.on("--lint-only") { options[:lint_only] = true }
end.parse!

sheet = ARGV.first or abort("usage: ruby render.rb path/to/sheet.html [--out x.png] [--scale 2] [--lint-only]")
sheet = File.expand_path(sheet)
File.exist?(sheet) or abort("no such file: #{sheet}")

def chrome_binary
  candidates = [
    ENV["CHROME_BIN"],
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    *Dir.glob(File.expand_path("~/Library/Caches/ms-playwright/chromium-*/chrome-mac*/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")).sort.reverse,
    *%w[google-chrome chromium chromium-browser].filter_map { |name| path = `command -v #{name} 2>/dev/null`.strip; path.empty? ? nil : path }
  ]
  candidates.compact.find { |path| File.executable?(path) } or abort("no Chrome found; set CHROME_BIN")
end

html = File.read(sheet, encoding: "UTF-8")
non_ascii = html.each_line.with_index(1).filter_map { |line, number| "line #{number}: #{line.strip[0, 70]}" if line.match?(/[^\x00-\x7F]/) }
non_ascii_issue = non_ascii.any? && { "kind" => "non-ascii", "detail" => "#{non_ascii.size} line(s); build_artifact.rb will refuse them; use HTML entities. First: #{non_ascii.first}" }
width, height = (html[/<meta name="one-pager:size" content="(\d+x\d+)"/, 1] || "1680x1050").split("x").map(&:to_i)
chrome = chrome_binary
url = "file://#{sheet}"

# Chrome leaves crashpad/updater helpers running that inherit its stdout; reading a pipe would then
# never see EOF and the render hangs. So: output to a file, its own process group, a timeout, and
# the whole group killed afterwards. Returns [output, Process::Status or nil on timeout].
def run_chrome(command, timeout: 90)
  Tempfile.create("one-pager-chrome-out") do |log|
    pid = Process.spawn(*command, out: log.path, err: [:child, :out], pgroup: true)
    deadline = Time.now + timeout
    status = nil
    until (finished = Process.wait2(pid, Process::WNOHANG))
      break if Time.now > deadline
      sleep 0.1
    end
    status = finished&.last
    begin
      Process.kill("-TERM", pid)
    rescue Errno::ESRCH, Errno::EPERM
      nil
    end
    Process.wait(pid) rescue nil unless status
    [File.read(log.path), status]
  end
end

def lint_dom(chrome, base, url)
  dom, status = run_chrome([chrome, *base, "--dump-dom", "#{url}?lint"])
  [dom, status]
end

# A throwaway profile keeps this off the user's Chrome profile and its caches.
Dir.mktmpdir("one-pager-chrome") do |profile|
  base = ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--user-data-dir=#{profile}",
          "--window-size=#{width},#{height}", "--virtual-time-budget=10000"]

  parse = lambda do |dom, status|
    json = dom[%r{<pre id="one-pager-lint">(.*?)</pre>}m, 1]
    if json
      JSON.parse(json.gsub("&quot;", '"').gsub("&lt;", "<").gsub("&gt;", ">").gsub("&amp;", "&"))["issues"]
    else
      [{ "kind" => "lint-missing", "detail" => "no #one-pager-lint output (did the sheet keep the template's self-check script?) chrome #{status ? "exit #{status.exitstatus}" : 'timed out'}" }]
    end
  end
  issues = parse.call(*lint_dom(chrome, base, url))
  # A cold first run can lint before Google Fonts arrive; a real fallback fails twice.
  issues = parse.call(*lint_dom(chrome, base, url)) if issues.any? { |issue| issue["kind"] == "font-fallback" }
  issues << non_ascii_issue if non_ascii_issue

  advice, issues = issues.partition { |issue| issue["advisory"] }
  format_issue = lambda do |issue|
    where = [issue["panel"] && "panel #{issue['panel']}", issue["svg"] && "svg #{issue['svg']}"].compact
    "  - #{issue['kind']}#{where.empty? ? '' : " [#{where.join(', ')}]"}: #{issue['detail']}"
  end
  if issues.empty?
    puts "lint: clean (#{width}x#{height})"
  else
    puts "lint: #{issues.size} issue(s)"
    issues.each { |issue| puts format_issue.call(issue) }
  end
  if advice.any?
    puts "advice: #{advice.size} (does not fail the render)"
    advice.each { |issue| puts format_issue.call(issue) }
  end

  unless options[:lint_only]
    out = File.expand_path(options[:out] || sheet.sub(/\.html\z/, ".png"))
    File.delete(out) if File.exist?(out)
    _, shot_status = run_chrome([chrome, *base, "--force-device-scale-factor=#{options[:scale]}", "--screenshot=#{out}", url])
    exit 2 unless shot_status&.success? && File.exist?(out)
    # PNG IHDR: width and height are big-endian uint32s at bytes 16..23 (no macOS-only sips).
    header = File.binread(out, 24)
    dimensions = header && header.bytesize == 24 && header.start_with?("\x89PNG".b) ? header[16, 8].unpack("NN").join("x") : ""
    puts "png: #{out}#{dimensions.empty? ? '' : " (#{dimensions})"}"
  end

  exit(issues.empty? ? 0 : 1)
end
