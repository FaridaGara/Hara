"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ApiError, favoritesApi, type HaraEvent } from "@/lib/api";

import { useAuth } from "./auth-provider";

type FavoritesContextValue = {
  favorites: HaraEvent[];
  loading: boolean;
  error: string | null;
  isFavorite: (eventId: string) => boolean;
  toggleFavorite: (event: HaraEvent) => Promise<void>;
  refreshFavorites: () => void;
};

type FavoritesState = {
  ownerId: number | null;
  events: HaraEvent[];
  error: string | null;
};

const EMPTY_FAVORITES: FavoritesContextValue = {
  favorites: [],
  loading: false,
  error: null,
  isFavorite: () => false,
  toggleFavorite: async () => undefined,
  refreshFavorites: () => undefined,
};

const FavoritesContext = createContext<FavoritesContextValue | null>(null);
const NO_FAVORITES: HaraEvent[] = [];

function favoriteErrorMessage(error: unknown) {
  return error instanceof ApiError
    ? error.message
    : "Sevimliləri yeniləmək mümkün olmadı.";
}

export function FavoritesProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { status, user } = useAuth();
  const [retryKey, setRetryKey] = useState(0);
  const [state, setState] = useState<FavoritesState>({
    ownerId: null,
    events: [],
    error: null,
  });
  const mutationVersion = useRef(0);

  useEffect(() => {
    if (status !== "authenticated" || !user) return;

    const controller = new AbortController();
    const requestOwnerId = user.id;
    const requestMutationVersion = mutationVersion.current;

    favoritesApi
      .list(controller.signal)
      .then((events) => {
        if (requestMutationVersion !== mutationVersion.current) return;
        setState({ ownerId: requestOwnerId, events, error: null });
      })
      .catch((error) => {
        if (error instanceof ApiError && error.kind === "cancelled") return;
        setState({
          ownerId: requestOwnerId,
          events: [],
          error: favoriteErrorMessage(error),
        });
      });

    return () => controller.abort();
  }, [retryKey, status, user]);

  const ownsState =
    status === "authenticated" && Boolean(user) && state.ownerId === user?.id;
  const favorites = useMemo(
    () => (ownsState ? state.events : NO_FAVORITES),
    [ownsState, state.events],
  );
  const loading =
    status === "loading" ||
    (status === "authenticated" && (!user || !ownsState));
  const error = ownsState ? state.error : null;

  const isFavorite = useCallback(
    (eventId: string) => favorites.some((event) => event.id === eventId),
    [favorites],
  );

  const toggleFavorite = useCallback(
    async (event: HaraEvent) => {
      if (status !== "authenticated" || !user) {
        const next = pathname || "/";
        router.push(`/login?next=${encodeURIComponent(next)}`);
        return;
      }

      const wasFavorite = favorites.some((favorite) => favorite.id === event.id);
      const previousEvents = favorites;
      const optimisticEvents = wasFavorite
        ? favorites.filter((favorite) => favorite.id !== event.id)
        : [event, ...favorites];

      mutationVersion.current += 1;
      setState({ ownerId: user.id, events: optimisticEvents, error: null });

      try {
        if (wasFavorite) await favoritesApi.remove(event.id);
        else await favoritesApi.add(event.id);
      } catch (requestError) {
        setState({
          ownerId: user.id,
          events: previousEvents,
          error: favoriteErrorMessage(requestError),
        });
      }
    },
    [favorites, pathname, router, status, user],
  );

  const refreshFavorites = useCallback(() => {
    if (status !== "authenticated" || !user) return;
    setState({ ownerId: null, events: [], error: null });
    setRetryKey((value) => value + 1);
  }, [status, user]);

  const value = useMemo(
    () => ({
      favorites,
      loading,
      error,
      isFavorite,
      toggleFavorite,
      refreshFavorites,
    }),
    [favorites, loading, error, isFavorite, toggleFavorite, refreshFavorites],
  );

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

export function useFavorites() {
  return useContext(FavoritesContext) ?? EMPTY_FAVORITES;
}
