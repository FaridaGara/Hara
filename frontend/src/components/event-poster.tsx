import { safePosterUrl } from "@/lib/format";

const fallbackPosterColor = "#171720";

function parseHexColor(color: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return null;

  const normalized =
    match[1].length === 3
      ? match[1]
          .split("")
          .map((symbol) => symbol.repeat(2))
          .join("")
      : match[1];

  const value = Number.parseInt(normalized, 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function rgbColorWithAlpha(color: string, alpha: number): string {
  const rgb = parseHexColor(color) ?? parseHexColor(fallbackPosterColor);
  if (!rgb) return `rgba(23, 18, 32, ${alpha})`;

  const [red, green, blue] = rgb;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function EventPoster({
  src,
  title,
  priority = false,
  className = "",
  posterColor = fallbackPosterColor,
}: {
  src: string;
  title: string;
  priority?: boolean;
  className?: string;
  posterColor?: string;
}) {
  const safeSrc = safePosterUrl(src);
  const normalizedPosterColor = parseHexColor(posterColor)
    ? posterColor
    : fallbackPosterColor;
  const background = `radial-gradient(circle at 30% 20%, ${rgbColorWithAlpha(
    normalizedPosterColor,
    0.42,
  )}, transparent 48%), ${normalizedPosterColor}`;

  return (
    <div className={`relative overflow-hidden ${className}`} style={{ background }}>
      {safeSrc ? (
        // Event posters may be hosted on arbitrary HTTP(S) origins supplied by
        // the API, so Next Image cannot safely declare a finite remote allowlist.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={safeSrc}
          alt={`${title} posteri`}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="grid h-full min-h-40 place-items-center px-6 text-center text-sm font-semibold text-white/35">
          Poster yoxdur
        </div>
      )}
    </div>
  );
}
