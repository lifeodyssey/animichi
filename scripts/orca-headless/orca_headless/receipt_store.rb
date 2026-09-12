# frozen_string_literal: true

require "json"
require "securerandom"
require "time"

module OrcaHeadless
  class ReceiptStore
    attr_reader :path

    def self.create(path)
      Dir.mkdir(path, 0o700)
      File.chmod(0o700, path)
      new(path)
    rescue Errno::EEXIST
      raise InputError, "state directory already exists: #{path}"
    end

    def initialize(path)
      @path = path
    end

    def write_json(name, value)
      write(name, JSON.pretty_generate(value) + "\n")
    end

    def write(name, bytes)
      AtomicFile.publish(File.join(path, name), bytes)
    end

    def failure(stage, error)
      write_json("failure.json", failure_payload(stage, error))
    rescue InputError
      nil
    end

    def failure_payload(stage, error)
      { "stage" => stage, "error" => error.class.name,
        "message" => error.message, "recordedAt" => Time.now.utc.iso8601 }
    end

    def inspection_prefix(kind)
      directory = File.join(path, "inspections")
      ensure_private_directory(directory)
      stamp = Time.now.utc.strftime("%Y%m%dT%H%M%S%6N")
      "inspections/#{kind}-#{stamp}-#{SecureRandom.hex(4)}"
    end

    private

    def ensure_private_directory(directory)
      Dir.mkdir(directory, 0o700)
      File.chmod(0o700, directory)
    rescue Errno::EEXIST
      raise InputError, "inspection path is not a directory" unless File.directory?(directory)
    end
  end
end
