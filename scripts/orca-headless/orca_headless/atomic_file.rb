# frozen_string_literal: true

require "securerandom"

module OrcaHeadless
  module AtomicFile
    module_function

    def publish(path, bytes, mover: File.method(:rename))
      raise InputError, "receipt already exists: #{path}" if File.exist?(path)

      pending = "#{path}.pending-#{SecureRandom.hex(8)}"
      write_private(pending, bytes)
      mover.call(pending, path)
    ensure
      File.delete(pending) if pending && File.exist?(pending)
    end

    def write_private(path, bytes)
      flags = File::WRONLY | File::CREAT | File::EXCL
      File.open(path, flags, 0o600) do |file|
        file.binmode
        file.write(bytes)
        file.flush
        file.fsync
      end
    end
  end
end
