import { safePosterUrl } from "@/lib/format";

export function EventPoster({
  src,
  title,
  priority = false,
  className = "",
}: {
  src: string;
  title: string;
  priority?: boolean;
  className?: string;
}) {
  const safeSrc = safePosterUrl(src);

  return (
    <div
      className={`relative overflow-hidden bg-[radial-gradient(circle_at_30%_20%,rgba(86,93,216,0.42),transparent_48%),#171720] ${className}`}
    >
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
