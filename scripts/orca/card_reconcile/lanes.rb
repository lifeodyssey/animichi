# frozen_string_literal: true

module Orca
  module CardReconcile
    Phase = Struct.new(:dir, :name, :task_id, :workspace, :provider, :run_id, :coordinator,
                       :launched_at, :exited_at, :runner_alive) do
      def running?
        runner_alive == true && exited_at.nil?
      end

      # A phase without an exit receipt is dead only when the process-table read says so; an
      # unknown liveness (`nil`) must not assert that the runner died.
      def dead?
        runner_alive == false || !exited_at.nil?
      end

      def since
        exited_at || launched_at
      end
    end

    Lane = Struct.new(:card, :dirs, :phases) do
      def newest_phase
        phases.max_by { |phase| phase.launched_at.to_s }
      end
    end

    class LaneReader
      CARD_DIR = /\Aanimichi-lane-(\d+)/.freeze
      # The receipt fields the phases are derived from: a receipt missing one of them is refused
      # instead of nil-ing its way into the row ladder as a fact the lane never stated.
      LAUNCH = { "taskId" => :text, "workspace" => :text, "provider" => :text, "runId" => :text,
                 "coordinatorHandle" => :text, "recordedAt" => :time }.freeze
      EXIT = { "observedAt" => :time }.freeze

      def initialize(root, probe)
        @root = root
        @probe = probe
      end

      def lanes
        grouped.keys.sort
               .map { |card| Lane.new(card, grouped[card], phases(grouped[card])) }
               .reject { |lane| lane.phases.empty? }
      end

      private

      def card_dirs
        Dir.glob(File.join(@root, "animichi-lane-*"))
           .select { |dir| File.directory?(dir) }
           .map { |dir| [card_of(dir), dir] }
           .reject { |card, _| card.nil? }
      end

      def card_of(dir)
        match = CARD_DIR.match(File.basename(dir))
        match && Integer(match[1], 10)
      end

      def grouped
        card_dirs.each_with_object({}) { |(card, dir), result| (result[card] ||= []) << dir }
      end

      def phases(dirs)
        dirs.flat_map { |dir| Dir.glob(File.join(dir, "**", "launch.json")).map { |path| phase(path) } }
            .sort_by { |item| item.launched_at.to_s }
      end

      def phase(launch_path)
        launch = Receipt.read_validated(launch_path, "launch receipt", LAUNCH)
        dir = File.dirname(launch_path)
        exit_receipt = Receipt.read_validated_optional(File.join(dir, "exit.json"),
                                                       "exit receipt", EXIT)
        Phase.new(dir, File.basename(dir), launch["taskId"], launch["workspace"], launch["provider"],
                  launch["runId"], launch["coordinatorHandle"], Shape.time(launch["recordedAt"]),
                  exit_receipt && Shape.time(exit_receipt["observedAt"]), @probe.call(dir))
      end
    end
  end
end
