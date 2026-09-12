# frozen_string_literal: true

require "securerandom"

module OrcaHeadless
  module AtomicFile
    module_function

    def publish(path, bytes, mover: File.method(:link), syncer: method(:sync_directory))
      raise InputError, "receipt already exists: #{path}" if File.exist?(path)

      pending = "#{path}.pending-#{SecureRandom.hex(8)}"
      write_private(pending, bytes)
      publish_pending(pending, path, mover)
      delete_pending(pending)
      syncer.call(File.dirname(path))
    ensure
      delete_pending(pending)
    end

    def publish_pending(pending, path, mover)
      mover.call(pending, path)
    rescue Errno::EEXIST
      raise InputError, "receipt already exists: #{path}"
    end

    def delete_pending(path)
      File.delete(path) if path && File.exist?(path)
    end

    def sync_directory(path)
      File.open(path, File::RDONLY) { |directory| directory.fsync }
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
