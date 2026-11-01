# Ground truth for the page's simulator: is Rack::Runtime (x-runtime) hit per config x path?
require 'rack'
require 'stringio'
app_ = ->(e) { [200, {}, ["SN=#{e['SCRIPT_NAME'].inspect} PI=#{e['PATH_INFO'].inspect}"]] }
api_ = app_
cfgs = {
  'after'  => Rack::Builder.app { use Rack::CommonLogger, StringIO.new; map('/api') { run api_ }; use Rack::Runtime; run app_ },
  'before' => Rack::Builder.app { use Rack::CommonLogger, StringIO.new; use Rack::Runtime; map('/api') { run api_ }; run app_ },
  'inside' => Rack::Builder.app { use Rack::CommonLogger, StringIO.new; map('/api') { use Rack::Runtime; run api_ }; use Rack::Runtime; run app_ },
}
cfgs.each do |k, a|
  %w[/api/users /other /apix].each do |p|
    r = Rack::MockRequest.new(a).get(p)
    puts "#{k.ljust(6)} #{p.ljust(10)} runtime=#{r.headers.key?('x-runtime') ? 'yes' : 'no '} #{r.status} #{r.body}"
  end
end
