import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import RouteTimeline from "./RouteTimeline";
import { POINTS_UJI, POINTS_MIXED_AREAS } from "@/stories/fixtures";
import type { TimedItinerary, TimedStop } from "@/lib/types";

const meta = {
  title: "Generative/RouteTimeline",
  component: RouteTimeline,
  tags: ["autodocs"],
  args: { onStopClick: fn() },
} satisfies Meta<typeof RouteTimeline>;

export default meta;
type Story = StoryObj<typeof meta>;

function makeStop(id: string, name: string, arrive: string, depart: string, points: typeof POINTS_UJI): TimedStop {
  return {
    cluster_id: id,
    name,
    arrive,
    depart,
    dwell_minutes: 30,
    lat: points[0].latitude,
    lng: points[0].longitude,
    photo_count: points.length,
    points,
  };
}

function makeItinerary(stopDefs: Array<{ id: string; name: string; arrive: string; depart: string; points: typeof POINTS_UJI }>, walkMinutes = 8): TimedItinerary {
  const stops = stopDefs.map((s) => makeStop(s.id, s.name, s.arrive, s.depart, s.points));
  const legs = stops.slice(0, -1).map((stop, i) => ({
    from_id: stop.cluster_id,
    to_id: stops[i + 1].cluster_id,
    mode: "walk" as const,
    duration_minutes: walkMinutes,
    distance_m: walkMinutes * 80,
  }));
  return {
    stops,
    legs,
    total_minutes: stopDefs.length * 30 + legs.length * walkMinutes,
    total_distance_m: legs.reduce((s, l) => s + l.distance_m, 0),
    spot_count: stops.reduce((s, st) => s + st.photo_count, 0),
    pacing: "normal",
    start_time: "09:00",
    export_google_maps_url: [],
    export_ics: "",
  };
}

const UJI_ITINERARY = makeItinerary([
  { id: "s1", name: "宇治橋", arrive: "09:00", depart: "09:30", points: [POINTS_UJI[0]] },
  { id: "s2", name: "宇治神社", arrive: "09:38", depart: "10:08", points: [POINTS_UJI[2]] },
  { id: "s3", name: "北宇治高校", arrive: "10:16", depart: "10:46", points: [POINTS_UJI[3]] },
]);

export const Default: Story = {
  args: { itinerary: UJI_ITINERARY },
};

export const WithActiveStop: Story = {
  args: {
    itinerary: UJI_ITINERARY,
    activeStopId: "s2",
  },
};

export const ShortWalks: Story = {
  name: "ShortWalks (no discovery card)",
  args: {
    itinerary: makeItinerary([
      { id: "s1", name: "宇治橋", arrive: "09:00", depart: "09:30", points: [POINTS_UJI[0]] },
      { id: "s2", name: "京阪宇治駅", arrive: "09:04", depart: "09:34", points: [POINTS_UJI[1]] },
    ], 4),
  },
};

export const LongWalks: Story = {
  name: "LongWalks (with discovery cards)",
  args: {
    itinerary: makeItinerary([
      { id: "s1", name: "宇治橋", arrive: "09:00", depart: "09:30", points: [POINTS_UJI[0]] },
      { id: "s2", name: "伏見稲荷大社", arrive: "10:20", depart: "10:50", points: [POINTS_MIXED_AREAS[5]] },
    ], 50),
  },
};

export const SingleStop: Story = {
  args: {
    itinerary: {
      stops: [makeStop("s1", "宇治橋", "09:00", "09:30", [POINTS_UJI[0]])],
      legs: [],
      total_minutes: 30,
      total_distance_m: 0,
      spot_count: 1,
      pacing: "chill",
      start_time: "09:00",
      export_google_maps_url: [],
      export_ics: "",
    },
  },
};
