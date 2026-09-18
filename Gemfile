# The interpreter and the test gems every Ruby suite in this repository runs on (#1774).
# Run a suite through the bundle — `bundle exec ruby <file>` — so the interpreter is
# `.ruby-version`'s and the gems are this lockfile's, locally and in CI alike.
source "https://rubygems.org"

ruby file: ".ruby-version"

gem "minitest", "~> 6.0"
# minitest 6.0 extracted `minitest/mock` (Minitest::Mock, Object#stub) into this gem.
gem "minitest-mock", "~> 5.27"
