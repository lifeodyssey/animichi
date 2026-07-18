import type { TimedStop } from "@seichijunrei/contract";
import type { ShioriRouteProps } from "../types";
import { ShioriFrame, ShioriHeader, ShioriTimeWindow } from "./ShioriChrome";

/** 計画版の切符スタイル: fixed timeline ticket for a planned route. */
export function Ticket({ meta, itinerary }: ShioriRouteProps) {
  return (
    <ShioriFrame layout="ticket" label="計画しおり">
      <ShioriHeader eyebrow="SEICHIJUNREI · しおり" meta={meta} />
      <TicketStops stops={itinerary.stops} />
      <ShioriTimeWindow itinerary={itinerary} />
    </ShioriFrame>
  );
}

function TicketStops({ stops }: Readonly<{ stops: TimedStop[] }>) {
  if (stops.length === 0) {
    return <p className="shiori-empty">スポットを選ぶと、ここに行程が出るよ</p>;
  }
  return <TicketStopList stops={stops} />;
}

function TicketStopList({ stops }: Readonly<{ stops: TimedStop[] }>) {
  return (
    <ol className="shiori-stops">
      {stops.map((stop) => (
        <TicketStopRow key={stop.cluster_id} stop={stop} />
      ))}
    </ol>
  );
}

function TicketStopRow({ stop }: Readonly<{ stop: TimedStop }>) {
  return (
    <li className="shiori-stop">
      <span className="shiori-stop__time">{stop.arrive}</span>
      <span className="shiori-stop__name">{stop.name}</span>
    </li>
  );
}
