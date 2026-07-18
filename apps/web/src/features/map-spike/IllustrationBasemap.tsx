import { illustrationSpotPoints, polylinePoints, svgTranslate, type Point } from "./geometry";
import { pinFill, pinLabel, pinRadius, pinStroke, pinTextFill } from "./pins";
import { STATIC_SIZE, type Spot } from "./spots";

type PinMarkProps = Readonly<{ spot: Spot; point: Point; index: number }>;

const VIEW_BOX = `0 0 ${STATIC_SIZE.width.toString()} ${STATIC_SIZE.height.toString()}`;

function RouteLine({ points }: Readonly<{ points: readonly Point[] }>) {
  const line = polylinePoints(points);
  return <polyline points={line} fill="none" stroke="var(--color-map-pin-brand)" strokeWidth={8} strokeLinecap="round" strokeDasharray="18 16" />;
}

function PinMark({ spot, point, index }: PinMarkProps) {
  return (
    <g transform={svgTranslate(point)}>
      <circle r={pinRadius(spot.kind)} fill={pinFill(spot.kind)} stroke={pinStroke(spot.kind)} strokeWidth={3} />
      <text y={6} textAnchor="middle" fontSize={18} fontWeight={800} fill={pinTextFill(spot.kind)}>{pinLabel(spot, index)}</text>
    </g>
  );
}

export function IllustrationBasemap() {
  const spots = illustrationSpotPoints();
  return (<svg className="map-spike__illustration" viewBox={VIEW_BOX} role="img" aria-label="宇治エリアの巡礼ルート図">
    <RouteLine points={spots.map((pair) => pair.point)} />
    {spots.map((pair, i) => <PinMark key={pair.spot.id} spot={pair.spot} point={pair.point} index={i} />)}
  </svg>);
}
