import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  BarChart3,
  Bell,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Clock,
  Cpu,
  Crosshair,
  Flame,
  LogIn,
  LogOut,
  Map as MapIcon,
  Menu,
  Moon,
  Search,
  Settings,
  Sun,
  X,
} from 'lucide-react';
import { AuthModal } from './components/AuthModal.tsx';
import { PollutionMap } from './components/PollutionMap.tsx';
import { AuthProvider, useAuth } from './hooks/useAuth.tsx';
import { AdminSettingsPage } from './pages/AdminSettingsPage.tsx';
import { AlertsPage } from './pages/AlertsPage.tsx';
import { AnalyticsPage } from './pages/AnalyticsPage.tsx';
import { HistoricalDataPage } from './pages/HistoricalDataPage.tsx';
import { HotspotsPage } from './pages/HotspotsPage.tsx';
import { LocationSearchPage } from './pages/LocationSearchPage.tsx';
import { OverviewPage } from './pages/OverviewPage.tsx';
import { PredictionsPage } from './pages/PredictionsPage.tsx';
import { SavedLocationsPage } from './pages/SavedLocationsPage.tsx';
import { api, createTelemetrySocket } from './services/api.ts';
import type {
  ActiveLocation,
  AirQualityReading,
  ForecastResponse,
  GeocodingResult,
  HotspotResponse,
  HourlyPoint,
  NavPageId,
  PollutionAlert,
  StationNode,
} from './types/env.ts';

const NAV_ITEMS: Array<{ id: NavPageId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'overview', label: 'Overview Dashboard', icon: Activity },
  { id: 'map', label: 'Live Pollution Map', icon: MapIcon },
  { id: 'search', label: 'Location Search', icon: Search },
  { id: 'analytics', label: 'Pollution Analytics', icon: BarChart3 },
  { id: 'predictions', label: 'AI Predictions', icon: Cpu },
  { id: 'hotspots', label: 'Pollution Hotspots', icon: Flame },
  { id: 'alerts', label: 'Alerts & Notifications', icon: Bell },
  { id: 'saved', label: 'Saved Locations', icon: Bookmark },
  { id: 'history', label: 'Historical Data', icon: Clock },
  { id: 'settings', label: 'Admin & Settings', icon: Settings },
];

const DEFAULT_LOCATION: ActiveLocation = {
  name: 'San Francisco',
  country: 'United States',
  region: 'California',
  lat: 37.7749,
  lon: -122.4194,
};

class MapErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error?.message || 'Unexpected map rendering error.' };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-6 text-center space-y-3">
          <div className="text-sm font-semibold text-rose-600 dark:text-rose-300">
            Interactive Map Encountered an Error
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300">{this.state.message}</p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, message: '' })}
            className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium"
          >
            Retry Map
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function DashboardShell() {
  const {
    user,
    logout,
    saveLocation,
    pushRealtimeAlert,
    alerts,
    preferredStandard,
    setPreferredStandard,
  } = useAuth();

  const [activePage, setActivePage] = useState<NavPageId>('overview');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [authModalOpen, setAuthModalOpen] = useState(false);

  const [activeLocation, setActiveLocation] = useState<ActiveLocation>(DEFAULT_LOCATION);
  const [refreshIntervalSec, setRefreshIntervalSec] = useState(60);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(true);

  // Global search bar state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchSuggestions, setSearchSuggestions] = useState<GeocodingResult[]>([]);
  const [searchingGlobal, setSearchingGlobal] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Environmental Data State
  const [currentReading, setCurrentReading] = useState<AirQualityReading | null>(null);
  const [historyDays, setHistoryDays] = useState(7);
  const [hourlyHistory, setHourlyHistory] = useState<HourlyPoint[]>([]);
  const [observedStations, setObservedStations] = useState<StationNode[]>([]);
  const [modeledGrid, setModeledGrid] = useState<StationNode[]>([]);
  const [iotStations, setIotStations] = useState<StationNode[]>([]);

  // AI & Hotspot State
  const [aiTarget, setAiTarget] = useState('pm2_5');
  const [aiHorizon, setAiHorizon] = useState(24);
  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [loadingAi, setLoadingAi] = useState(false);

  const [hotspotParams, setHotspotParams] = useState({
    pollutant: 'pm2_5',
    epsKm: 8.5,
    threshold: 25,
  });
  const [hotspotsRes, setHotspotsRes] = useState<HotspotResponse | null>(null);
  const [loadingHotspots, setLoadingHotspots] = useState(false);

  const [loadingTelemetry, setLoadingTelemetry] = useState(false);
  const [locatingUser, setLocatingUser] = useState(false);
  const [lastRefreshIso, setLastRefreshIso] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const socketRef = useRef<ReturnType<typeof createTelemetrySocket> | null>(null);

  // Sync dark/light mode class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => {
      setToastMessage((curr) => (curr === msg ? null : curr));
    }, 4500);
  }, []);

  const loadAllLocationData = useCallback(
    async (loc: ActiveLocation, daysCount: number, forceRefresh = false) => {
      setLoadingTelemetry(true);
      try {
        const [cur, hist, st] = await Promise.all([
          api.getCurrentAirQuality(loc.lat, loc.lon, loc.name, forceRefresh),
          api.getHistory(loc.lat, loc.lon, daysCount, forceRefresh),
          api.getStations(loc.lat, loc.lon, 25, forceRefresh),
        ]);
        setCurrentReading(cur);
        setHourlyHistory(hist.hourlyPast);
        setObservedStations(st.observedStations);
        setModeledGrid(st.modeledGrid);
        setIotStations(st.iotStations);
        setLastRefreshIso(new Date().toISOString());
      } catch (err) {
        showToast(
          err instanceof Error ? err.message : 'Unable to refresh live telemetry right now.'
        );
      } finally {
        setLoadingTelemetry(false);
      }
    },
    [showToast]
  );

  const loadForecast = useCallback(
    async (loc: ActiveLocation, target: string, horizon: number, retrain = false) => {
      setLoadingAi(true);
      try {
        const res = await api.getPredictions(loc.lat, loc.lon, target, horizon, retrain);
        setForecast(res);
      } catch (err) {
        console.error('AI forecast load failed:', err);
      } finally {
        setLoadingAi(false);
      }
    },
    []
  );

  const loadHotspots = useCallback(
    async (
      loc: ActiveLocation,
      params: { pollutant: string; epsKm: number; threshold: number }
    ) => {
      setLoadingHotspots(true);
      try {
        const res = await api.getHotspots(
          loc.lat,
          loc.lon,
          params.pollutant,
          params.epsKm,
          params.threshold
        );
        setHotspotsRes(res);
      } catch (err) {
        console.error('Hotspot detection failed:', err);
      } finally {
        setLoadingHotspots(false);
      }
    },
    []
  );

  // Initial + location change load
  useEffect(() => {
    void loadAllLocationData(activeLocation, historyDays);
    void loadForecast(activeLocation, aiTarget, aiHorizon);
    void loadHotspots(activeLocation, hotspotParams);
  }, [
    activeLocation,
    historyDays,
    aiTarget,
    aiHorizon,
    hotspotParams,
    loadAllLocationData,
    loadForecast,
    loadHotspots,
  ]);

  // WebSocket live push connection
  useEffect(() => {
    const client = createTelemetrySocket(
      activeLocation,
      user?.uid,
      refreshIntervalSec,
      (reading) => {
        setCurrentReading(reading);
        setLastRefreshIso(new Date().toISOString());
      },
      (alert: PollutionAlert) => {
        pushRealtimeAlert(alert);
        showToast(
          `Alert: ${alert.locationName} ${alert.metric.toUpperCase()} at ${alert.observedValue}`
        );
      },
      (connected) => setWsConnected(connected)
    );
    socketRef.current = client;
    return () => {
      client.close();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    socketRef.current?.subscribe(activeLocation, user?.uid, refreshIntervalSec);
  }, [activeLocation, user?.uid, refreshIntervalSec]);

  useEffect(() => {
    socketRef.current?.setIntervalSec(autoSyncEnabled ? refreshIntervalSec : 3600);
  }, [autoSyncEnabled, refreshIntervalSec]);

  // Client-side auto-sync (keeps history/stations/grid synced and acts as HTTP fallback when WS is disconnected)
  useEffect(() => {
    if (!autoSyncEnabled) return;
    const intervalMs = Math.max(15, refreshIntervalSec) * 1000;
    const timer = window.setInterval(() => {
      void loadAllLocationData(activeLocation, historyDays, true);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [autoSyncEnabled, activeLocation, historyDays, refreshIntervalSec, loadAllLocationData]);

  // Autocomplete search debounce
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchSuggestions([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      setSearchingGlobal(true);
      try {
        const res = await api.searchLocations(q);
        setSearchSuggestions(res.results);
      } catch {
        setSearchSuggestions([]);
      } finally {
        setSearchingGlobal(false);
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const handleSelectSearchSuggestion = (item: GeocodingResult) => {
    setActiveLocation({
      name: item.name,
      country: item.country,
      region: item.region,
      lat: item.lat,
      lon: item.lon,
    });
    setSearchQuery('');
    setShowSuggestions(false);
    if (activePage === 'search') {
      setActivePage('map');
    }
  };

  const handleSaveCurrentLocation = async (loc?: {
    name: string;
    country: string;
    region: string;
    lat: number;
    lon: number;
  }) => {
    if (!user) {
      setAuthModalOpen(true);
      return;
    }
    const target = loc ?? {
      name: activeLocation.name,
      country: activeLocation.country || '',
      region: activeLocation.region || '',
      lat: activeLocation.lat,
      lon: activeLocation.lon,
    };
    try {
      await saveLocation(target);
      showToast(`Saved "${target.name}" to your locations.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save location.');
    }
  };

  const handleLocateUser = useCallback(() => {
    setLocatingUser(true);

    const fallbackToIp = async (reason?: string) => {
      try {
        const ipLoc = await api.geolocateByIp();
        setActiveLocation({
          name: ipLoc.name,
          region: ipLoc.region,
          country: ipLoc.country,
          lat: ipLoc.lat,
          lon: ipLoc.lon,
        });
        showToast(
          `${reason ? `${reason} · ` : ''}Using approximate IP location: ${ipLoc.name}`
        );
      } catch (ipErr) {
        showToast(
          `Unable to retrieve location (${reason || 'denied'}). ${ipErr instanceof Error ? ipErr.message : ''}`
        );
      } finally {
        setLocatingUser(false);
      }
    };

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      void fallbackToIp('Browser geolocation unsupported');
      return;
    }

    try {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const lat = Number(pos.coords.latitude.toFixed(5));
          const lon = Number(pos.coords.longitude.toFixed(5));
          let label = 'Current Location';
          let region = '';
          let country = '';
          try {
            const rev = await api.reverseGeocode(lat, lon);
            label = rev.name || label;
            region = rev.region;
            country = rev.country;
          } catch {
            // keep generic coordinate label if reverse geocoding fails
          }
          setActiveLocation({ name: label, region, country, lat, lon });
          showToast(`Located via browser GPS: ${label} (${lat.toFixed(4)}, ${lon.toFixed(4)})`);
          setLocatingUser(false);
        },
        (err) => {
          void fallbackToIp(err.message || 'Location permission unavailable');
        },
        { enableHighAccuracy: false, timeout: 6000, maximumAge: 60000 }
      );
    } catch (syncErr) {
      void fallbackToIp(syncErr instanceof Error ? syncErr.message : 'Blocked by iframe policy');
    }
  }, [showToast]);

  const activeAlertsCount = alerts.filter((a) => a.status === 'active').length;

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-[#070B14] text-slate-900 dark:text-slate-100">
      {/* Mobile Sidebar Overlay */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-[1000] bg-slate-950/60 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/* Collapsible Sidebar Navigation */}
      <aside
        className={`fixed lg:sticky top-0 left-0 z-[1050] h-screen border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B1120] flex flex-col transition-all duration-200 ${
          sidebarCollapsed ? 'lg:w-[68px]' : 'lg:w-[244px]'
        } ${mobileNavOpen ? 'translate-x-0 w-[256px]' : '-translate-x-full lg:translate-x-0'}`}
      >
        <div className="h-14 px-4 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 shrink-0">
          {!sidebarCollapsed && (
            <span className="text-base font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap">
              AetherGrid
            </span>
          )}
          <button
            type="button"
            onClick={() => setSidebarCollapsed((c) => !c)}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden lg:inline-flex p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {sidebarCollapsed ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <ChevronLeft className="w-4 h-4" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close navigation menu"
            className="lg:hidden p-1.5 rounded-lg text-slate-500"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-2.5 space-y-1" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activePage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActivePage(item.id);
                  setMobileNavOpen(false);
                }}
                title={sidebarCollapsed ? item.label : undefined}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/70 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                {!sidebarCollapsed && item.id === 'alerts' && activeAlertsCount > 0 && (
                  <span className="ml-auto font-mono text-[11px] text-amber-600 dark:text-amber-400">
                    {activeAlertsCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-200 dark:border-slate-800 text-xs">
          {user ? (
            <div className="flex items-center justify-between gap-2">
              {!sidebarCollapsed && (
                <div className="min-w-0">
                  <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                    {user.displayName}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">{user.role}</div>
                </div>
              )}
              <button
                type="button"
                onClick={() => logout()}
                title="Sign out"
                className="p-1.5 rounded-lg text-slate-500 hover:text-rose-500 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAuthModalOpen(true)}
              className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium"
            >
              <LogIn className="w-3.5 h-3.5 shrink-0" />
              {!sidebarCollapsed && <span>Sign In</span>}
            </button>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Navigation Bar (3-zone contract: Breadcrumb/Search/Action) */}
        <header className="sticky top-0 z-[900] h-14 px-4 lg:px-6 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-[#0B1120]/95 backdrop-blur-sm flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="hidden sm:block text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
              {NAV_ITEMS.find((i) => i.id === activePage)?.label} ·{' '}
              <span className="text-slate-900 dark:text-slate-100">{activeLocation.name}</span>
            </div>
          </div>

          {/* Global Location Search */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => window.setTimeout(() => setShowSuggestions(false), 200)}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setShowSuggestions(true);
              }}
              placeholder="Search city, neighborhood, address..."
              aria-label="Global location search"
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />

            {showSuggestions && searchQuery.trim().length >= 2 && (
              <div className="absolute left-0 right-0 mt-1 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1526] shadow-xl overflow-hidden z-[1100]">
                {searchingGlobal ? (
                  <div className="px-3.5 py-2.5 text-xs text-slate-500">Searching places...</div>
                ) : searchSuggestions.length === 0 ? (
                  <div className="px-3.5 py-2.5 text-xs text-slate-500">
                    No matching places found.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-72 overflow-y-auto">
                    {searchSuggestions.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onMouseDown={() => handleSelectSearchSuggestion(item)}
                        className="w-full text-left px-3.5 py-2.5 hover:bg-slate-100 dark:hover:bg-slate-800/70 transition-colors"
                      >
                        <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                          {item.name}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate">{item.displayName}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right Header Controls */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleLocateUser}
              disabled={locatingUser}
              title="Use my current location"
              aria-label="Retrieve current location"
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-60"
            >
              <Crosshair className={`w-4 h-4 text-cyan-500 ${locatingUser ? 'animate-pulse' : ''}`} />
            </button>

            <button
              type="button"
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              aria-label="Toggle light or dark mode"
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4 text-amber-400" />
              ) : (
                <Moon className="w-4 h-4 text-cyan-600" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setActivePage('alerts')}
              aria-label="Open alerts and notifications"
              className="relative p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Bell className="w-4 h-4" />
              {activeAlertsCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-500 text-[10px] font-mono font-bold text-slate-950 flex items-center justify-center">
                  {activeAlertsCount}
                </span>
              )}
            </button>
          </div>
        </header>

        {/* Notification Toast */}
        {toastMessage && (
          <div className="fixed bottom-4 right-4 z-[1300] max-w-sm rounded-xl border border-cyan-500/40 bg-white dark:bg-[#0D1526] px-4 py-3 text-xs text-slate-800 dark:text-slate-100 shadow-xl flex items-center justify-between gap-3">
            <span>{toastMessage}</span>
            <button
              type="button"
              onClick={() => setToastMessage(null)}
              className="text-slate-400 hover:text-slate-900 dark:hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Active Page Viewport */}
        <main className="flex-1 p-4 lg:p-6 max-w-[1440px] w-full mx-auto">
          {activePage === 'overview' && (
            <OverviewPage
              location={activeLocation}
              current={currentReading}
              history={hourlyHistory}
              forecast={forecast}
              stations={observedStations}
              hotspots={hotspotsRes?.hotspots ?? []}
              standard={preferredStandard}
              loading={loadingTelemetry}
              lastRefreshIso={lastRefreshIso}
              wsConnected={wsConnected}
              autoSyncEnabled={autoSyncEnabled}
              syncIntervalSec={refreshIntervalSec}
              onToggleAutoSync={() => setAutoSyncEnabled((v) => !v)}
              onChangeSyncInterval={setRefreshIntervalSec}
              onRefresh={() => {
                socketRef.current?.syncNow();
                void loadAllLocationData(activeLocation, historyDays, true);
              }}
              onSaveLocation={() => void handleSaveCurrentLocation()}
              onLocateUser={handleLocateUser}
              locatingUser={locatingUser}
              onNavigate={setActivePage}
            />
          )}

          {activePage === 'map' && (
            <div className="space-y-4">
              <div className="border-b border-slate-200 dark:border-slate-800 pb-3">
                <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
                  Live Smart City Pollution Map
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Interactive OpenStreetMap telemetry for {activeLocation.name}. Click &ldquo;Add Marker&rdquo; to place, drag, edit, and query pollution at custom coordinates.
                </p>
              </div>
              <MapErrorBoundary>
                <PollutionMap
                  activeLocation={activeLocation}
                  onSelectLocation={setActiveLocation}
                  stations={observedStations}
                  modeledGrid={modeledGrid}
                  iotStations={iotStations}
                  hotspots={hotspotsRes?.hotspots ?? []}
                  standard={preferredStandard}
                  theme={theme}
                  onRequireAuth={() => setAuthModalOpen(true)}
                />
              </MapErrorBoundary>
            </div>
          )}

          {activePage === 'search' && (
            <LocationSearchPage
              standard={preferredStandard}
              onSelectLocation={setActiveLocation}
              onSaveLocation={handleSaveCurrentLocation}
              onNavigate={setActivePage}
            />
          )}

          {activePage === 'analytics' && (
            <AnalyticsPage
              location={activeLocation}
              current={currentReading}
              history={hourlyHistory}
              observedStations={observedStations}
              modeledGrid={modeledGrid}
              days={historyDays}
              onDaysChange={setHistoryDays}
            />
          )}

          {activePage === 'predictions' && (
            <PredictionsPage
              location={activeLocation}
              history={hourlyHistory}
              forecast={forecast}
              target={aiTarget}
              horizon={aiHorizon}
              loading={loadingAi}
              onChangeTarget={setAiTarget}
              onChangeHorizon={setAiHorizon}
              onRetrain={() => void loadForecast(activeLocation, aiTarget, aiHorizon, true)}
            />
          )}

          {activePage === 'hotspots' && (
            <HotspotsPage
              location={activeLocation}
              current={currentReading}
              history={hourlyHistory}
              hotspotsRes={hotspotsRes}
              pollutant={hotspotParams.pollutant}
              epsKm={hotspotParams.epsKm}
              threshold={hotspotParams.threshold}
              loading={loadingHotspots}
              onChangeParams={(next) =>
                setHotspotParams((prev) => ({ ...prev, ...next }))
              }
              onRefresh={() => void loadHotspots(activeLocation, hotspotParams)}
              onNavigate={setActivePage}
            />
          )}

          {activePage === 'alerts' && (
            <AlertsPage
              location={activeLocation}
              onRequireAuth={() => setAuthModalOpen(true)}
            />
          )}

          {activePage === 'saved' && (
            <SavedLocationsPage
              standard={preferredStandard}
              onSelectLocation={setActiveLocation}
              onNavigate={setActivePage}
              onRequireAuth={() => setAuthModalOpen(true)}
            />
          )}

          {activePage === 'history' && (
            <HistoricalDataPage
              location={activeLocation}
              current={currentReading}
              history={hourlyHistory}
              days={historyDays}
              onDaysChange={setHistoryDays}
            />
          )}

          {activePage === 'settings' && (
            <AdminSettingsPage
              location={activeLocation}
              standard={preferredStandard}
              onChangeStandard={setPreferredStandard}
              theme={theme}
              onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              refreshIntervalSec={refreshIntervalSec}
              onChangeRefreshInterval={setRefreshIntervalSec}
              onRequireAuth={() => setAuthModalOpen(true)}
              onStationsUpdated={() => void loadAllLocationData(activeLocation, historyDays)}
            />
          )}
        </main>
      </div>

      <AuthModal open={authModalOpen} onClose={() => setAuthModalOpen(false)} />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <DashboardShell />
    </AuthProvider>
  );
}
