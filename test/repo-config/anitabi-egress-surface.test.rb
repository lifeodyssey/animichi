# SUT: the permitted surface of the upstream's API document (#1792), as the
# committed capture `apps/anitabi-egress/anitabi-api-surface.json` records it.
# The capture is the ONLY place a route, an upstream path, or a query parameter
# can come from: the service builds its requests from it, and the caller's two
# operations mirror it. Freezing the capture here is what makes widening the
# service a reviewed edit to two files rather than a quiet one to a constant.
require "minitest/autorun"
require "json"
require "open3"

class AnitabiEgressSurfaceTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  CAPTURE = "apps/anitabi-egress/anitabi-api-surface.json"
  SERVICE_BUILDER = "apps/anitabi-egress/src/upstream-operations.ts"
  CATALOG_CALLER = "workers/catalog/src/ingest/anitabi-egress.ts"

  # The two operations the document describes, and the two routes this service
  # serves. A capture edited to add a third fails here and in the service's own
  # unit tests — the two places a widening must be reviewed.
  OPERATIONS = [
    {
      "name" => "points",
      "egressPathTemplate" => "/anitabi/points/{bangumiId}",
      "upstreamPathTemplate" => "/bangumi/{bangumiId}/points/detail",
      "query" => [{ "name" => "haveImage", "value" => "true" }],
    },
    {
      "name" => "lite",
      "egressPathTemplate" => "/anitabi/lite/{bangumiId}",
      "upstreamPathTemplate" => "/bangumi/{bangumiId}/lite",
      "query" => [],
    },
  ].freeze

  # The image sizes the document permits, and the case that asks for none.
  IMAGE_PLANS = {
    "queryParameter" => "plan",
    "values" => %w[h160 h360],
    "fullResolution" => "omit the plan parameter",
  }.freeze

  # The main domain the document forbids requesting. It is neither of the two
  # origins the capture permits, and no module that builds a request may use it.
  FORBIDDEN_MAIN_ORIGIN = "https://anitabi.cn"
  FORBIDDEN_URL = %r{https?://(?:www\.)?anitabi\.cn(?![\w.\-/])}
  # The modules that build a request URL: the service's own source, and the
  # catalog's ingest and media paths. Scanned rather than the whole tree,
  # because the domain also appears as RECORDED ATTRIBUTION — the licence a
  # catalogued work carries — which is data, not a destination.
  REQUEST_BUILDERS = ["apps/anitabi-egress/src", "workers/catalog/src/ingest", "workers/catalog/src/media"].freeze
  ATTRIBUTION = /license\s*:/

  def test_the_capture_is_exactly_the_two_documented_operations
    assert_equal OPERATIONS, capture["operations"],
                 "#{CAPTURE} must declare the two operations the API document describes, and no third"
  end

  def test_the_capture_records_the_image_plans_the_document_permits
    assert_equal IMAGE_PLANS, capture["imagePlans"],
                 "#{CAPTURE}: the document permits ?plan=h160, ?plan=h360, and no parameter at all"
  end

  def test_the_capture_records_the_forbidden_main_domain
    assert_equal FORBIDDEN_MAIN_ORIGIN, capture["forbiddenMainOrigin"]
    refute_includes [capture["apiOrigin"], capture["imageOrigin"]], capture["forbiddenMainOrigin"],
                    "#{CAPTURE}: the forbidden main domain is not one of the permitted origins"
    assert_equal "https://api.anitabi.cn", capture["apiOrigin"]
    assert_equal "https://image.anitabi.cn", capture["imageOrigin"]
  end

  def test_the_service_builds_its_requests_from_the_capture
    source = read(SERVICE_BUILDER)
    assert_includes source, "surface.operations",
                    "#{SERVICE_BUILDER} must build its routes from the capture, not from literals"
    refute_match %r{"/anitabi/(?:points|lite)/}, source,
                 "#{SERVICE_BUILDER} hardcodes a route the capture is supposed to own"
    refute_includes source, capture["apiOrigin"],
                    "#{SERVICE_BUILDER} hardcodes the upstream origin; it belongs to the capture"
  end

  def test_the_caller_serves_the_capture_s_routes
    caller = read(CATALOG_CALLER)
    capture["operations"].each do |operation|
      path = operation["egressPathTemplate"].sub("/{bangumiId}", "/")
      assert_includes caller, path,
                      "#{CATALOG_CALLER} must call #{operation['egressPathTemplate']}, the route the service serves"
    end
  end

  def test_no_request_builder_requests_the_forbidden_main_domain
    offenders = request_builders.flat_map do |path|
      read(path).each_line.with_index(1)
                 .reject { |line, _| line.match?(ATTRIBUTION) }
                 .select { |line, _| line.match?(FORBIDDEN_URL) }
                 .map { |line, number| "#{path}:#{number}: #{line.strip}" }
    end
    assert_empty(offenders,
                 "the upstream forbids requesting its main domain in any scenario; these lines ask for it:\n  " \
                 "#{offenders.join("\n  ")}")
  end

  private

  def request_builders
    REQUEST_BUILDERS.flat_map do |directory|
      Dir.glob(File.join(ROOT, directory, "**", "*.ts")).map { |path| path.delete_prefix("#{ROOT}/") }
    end.sort
  end

  def capture
    JSON.parse(File.read(File.join(ROOT, CAPTURE)))
  end

  def read(path)
    File.read(File.join(ROOT, path))
  end

  def text_of(path)
    text = File.binread(File.join(ROOT, path))
    return "" if text.include?("\0")

    text.force_encoding(Encoding::UTF_8).scrub
  end

  def repository_files
    out, err, status = Open3.capture3("git", "ls-files", "-z", "--cached", "--others", "--exclude-standard", chdir: ROOT)
    assert_predicate(status, :success?, "git ls-files failed: #{err}")
    out.split("\0").select { |path| File.file?(File.join(ROOT, path)) }
  end
end
