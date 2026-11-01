# Probe: wrapping order of Rack::Builder, and what `use` after `map` covers.
# Run: ruby -I <rack checkout>/lib probe.rb   (rack/rack @ da90464)
require 'rack'
require 'rack/builder'
require 'rack/mock_request'

LOG = []
def mw(name)
  Class.new do
    define_method(:initialize) { |app| LOG << "init #{name} (wraps #{app.class.name || app.class})"; @app = app }
    define_method(:call) do |env|
      LOG << "#{name} in  SCRIPT_NAME=#{env['SCRIPT_NAME'].inspect} PATH_INFO=#{env['PATH_INFO'].inspect}"
      s, h, b = @app.call(env)
      LOG << "#{name} out"
      [s, h, b]
    end
  end
end
A, B, C = mw('A'), mw('B'), mw('C')
endpoint = ->(env) { LOG << "app  SCRIPT_NAME=#{env['SCRIPT_NAME'].inspect} PATH_INFO=#{env['PATH_INFO'].inspect}"; [200, {}, ['ok']] }

puts "== 1. use A; use B; run app  ->  GET /x"
LOG.clear
app = Rack::Builder.app { use A; use B; run endpoint }
puts "built: #{app.class}"
Rack::MockRequest.new(app).get('/x')
puts LOG

puts "\n== 2. use A; map('/api') { run app }; use C; run app  ->  GET /api/users and GET /other"
LOG.clear
app = Rack::Builder.app do
  use A
  map('/api') { run endpoint }
  use C
  run endpoint
end
puts "built: outermost=#{app.class}"
puts LOG; LOG.clear
puts "-- GET /api/users"; Rack::MockRequest.new(app).get('/api/users'); puts LOG; LOG.clear
puts "-- GET /other";     Rack::MockRequest.new(app).get('/other');     puts LOG; LOG.clear

puts "\n== 3. URLMap longest-prefix: map '/a' and '/a/b'  ->  GET /a/b/c and GET /ab"
app = Rack::Builder.app do
  map('/a')   { run ->(e) { [200, {}, ["/a   SN=#{e['SCRIPT_NAME']} PI=#{e['PATH_INFO']}"]] } }
  map('/a/b') { run ->(e) { [200, {}, ["/a/b SN=#{e['SCRIPT_NAME']} PI=#{e['PATH_INFO']}"]] } }
end
%w[/a/b/c /ab /a].each { |p| r = Rack::MockRequest.new(app).get(p); puts "#{p.ljust(7)} -> #{r.status} #{r.body} #{r.headers['x-cascade']}" }

puts "\n== 4. Builder#call rebuilds every request"
n = 0
b = Rack::Builder.new { warmup { |_| n += 1 }; run endpoint }
3.times { b.call(Rack::MockRequest.env_for('/')) }
puts "warmup ran #{n} times for 3 calls"

puts "\n== 5. no run"
begin; Rack::Builder.app { use A }; rescue => e; puts "#{e.class}: #{e.message}"; end

puts "\n== 6. BodyProxy: the after-hook fires on body.close, not when call returns"
LOG.clear
Logger6 = Class.new do
  def initialize(app) = @app = app
  def call(env)
    s, h, b = @app.call(env)
    LOG << "Logger6 call returned"
    [s, h, Rack::BodyProxy.new(b) { LOG << "Logger6 close callback (log line written)" }]
  end
end
app = Rack::Builder.app { use Logger6; run ->(e) { [200, {}, ['chunk1', 'chunk2']] } }
s, h, body = app.call(Rack::MockRequest.env_for('/'))
LOG << "server got response tuple"
body.each { |c| LOG << "server writes #{c}" }
body.close
puts LOG
