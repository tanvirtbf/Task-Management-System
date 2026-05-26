import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import maplibregl, { type Map as MlMap, type Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Button, Input } from "antd";
import { Search, UserCheck, Eye, EyeOff, MapPin } from "lucide-react";
import { mockApi } from "../../lib/mock-api";
import { useAuthStore } from "../../stores/auth";
import { statusesById } from "../../mocks/statuses";
import { DHAKA_CENTER, geocodeAddress } from "../../lib/dhaka-geocoder";
import { PriorityFlag } from "../ui/PriorityFlag";
import { StatusPill } from "../ui/StatusPill";
import { EmptyState } from "../ui/EmptyState";
import { tokens } from "../../theme";
import type { Task } from "../../types";

interface MapViewProps {
    listId: string;
}

interface GeocodedTask {
    task: Task;
    lat: number;
    lng: number;
    address: string;
}

const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

export const MapView = ({ listId }: MapViewProps) => {
    const user = useAuthStore((s) => s.user);
    const [, setSearchParams] = useSearchParams();
    const [search, setSearch] = useState("");
    const [meMode, setMeMode] = useState(false);
    const [showClosedTasks, setShowClosedTasks] = useState(false);
    const [selectedTask, setSelectedTask] = useState<GeocodedTask | null>(null);

    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<MlMap | null>(null);
    const markersRef = useRef<Marker[]>([]);

    const { data: tasks = [] } = useQuery({
        queryKey: ["tasks-by-list", listId],
        queryFn: () => mockApi.tasks.listByList(listId),
    });

    const filteredTasks = useMemo(() => {
        let r = tasks;
        if (!showClosedTasks) {
            r = r.filter((t) => {
                const s = statusesById.get(t.statusId);
                return s?.statusGroup !== "closed";
            });
        }
        if (meMode && user) r = r.filter((t) => t.assignees.includes(user.id));
        if (search.trim()) {
            const q = search.toLowerCase();
            r = r.filter(
                (t) =>
                    t.name.toLowerCase().includes(q) ||
                    t.customId?.toLowerCase().includes(q),
            );
        }
        return r;
    }, [tasks, showClosedTasks, meMode, search, user]);

    // Geocode tasks
    const geocoded = useMemo<GeocodedTask[]>(() => {
        const result: GeocodedTask[] = [];
        for (const task of filteredTasks) {
            const addr = task.customFields?.cf_address as
                | { text?: string }
                | undefined;
            const text = addr?.text;
            if (!text) continue;
            const point = geocodeAddress(text);
            if (point) {
                result.push({
                    task,
                    lat: point.lat,
                    lng: point.lng,
                    address: text,
                });
            }
        }
        return result;
    }, [filteredTasks]);

    // Initialize map once
    useEffect(() => {
        if (!mapContainerRef.current || mapRef.current) return;

        const map = new maplibregl.Map({
            container: mapContainerRef.current,
            style: MAP_STYLE_URL,
            center: [DHAKA_CENTER.lng, DHAKA_CENTER.lat],
            zoom: 11,
            attributionControl: { compact: true },
        });

        map.addControl(new maplibregl.NavigationControl({}), "top-right");
        map.addControl(
            new maplibregl.FullscreenControl({}),
            "top-right",
        );

        mapRef.current = map;

        return () => {
            map.remove();
            mapRef.current = null;
            markersRef.current = [];
        };
    }, []);

    // Sync markers with geocoded tasks
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        // Remove existing markers
        markersRef.current.forEach((m) => m.remove());
        markersRef.current = [];

        // Add new markers
        for (const item of geocoded) {
            const status = statusesById.get(item.task.statusId);
            const color = status?.color ?? tokens.colors.textMuted;

            const el = document.createElement("div");
            el.className = "th-map-pin";
            el.style.cssText = `
                width: 20px;
                height: 20px;
                border-radius: 50% 50% 50% 0;
                background: ${color};
                transform: rotate(-45deg);
                border: 2px solid #FFFFFF;
                box-shadow: 0 2px 6px rgba(0,0,0,0.25);
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: transform 0.15s ease-in-out;
            `;
            el.innerHTML = `<div style="
                width: 6px;
                height: 6px;
                background: #FFFFFF;
                border-radius: 50%;
                transform: rotate(45deg);
            "></div>`;
            el.addEventListener("mouseenter", () => {
                el.style.transform = "rotate(-45deg) scale(1.2)";
                el.style.zIndex = "10";
            });
            el.addEventListener("mouseleave", () => {
                el.style.transform = "rotate(-45deg) scale(1)";
                el.style.zIndex = "1";
            });
            el.addEventListener("click", (e) => {
                e.stopPropagation();
                setSelectedTask(item);
            });

            const marker = new maplibregl.Marker({
                element: el,
                anchor: "bottom",
            })
                .setLngLat([item.lng, item.lat])
                .addTo(map);
            markersRef.current.push(marker);
        }

        // Fit bounds to markers if any
        if (geocoded.length > 0) {
            const bounds = new maplibregl.LngLatBounds();
            geocoded.forEach((g) => bounds.extend([g.lng, g.lat]));
            map.fitBounds(bounds, {
                padding: 50,
                maxZoom: 13,
                duration: 600,
            });
        }
    }, [geocoded]);

    const tasksWithoutLocation = filteredTasks.length - geocoded.length;

    return (
        <>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: `${tokens.spacing[3]}px ${tokens.spacing[6]}px`,
                    background: tokens.colors.bgSurface,
                    borderBottom: `1px solid ${tokens.colors.border}`,
                    flexWrap: "wrap",
                }}
            >
                <span
                    style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        padding: "3px 8px",
                        background: tokens.colors.primarySubtle,
                        color: tokens.colors.primary,
                        borderRadius: tokens.radius.full,
                        fontSize: 11,
                        fontWeight: 600,
                    }}
                >
                    <MapPin size={11} strokeWidth={1.75} />
                    {geocoded.length} pins
                </span>
                {tasksWithoutLocation > 0 && (
                    <span
                        style={{
                            fontSize: 11,
                            color: tokens.colors.textMuted,
                        }}
                    >
                        {tasksWithoutLocation} task
                        {tasksWithoutLocation === 1 ? "" : "s"} without location
                    </span>
                )}

                <Button
                    type="text"
                    size="small"
                    icon={
                        showClosedTasks ? (
                            <Eye size={13} strokeWidth={1.75} />
                        ) : (
                            <EyeOff size={13} strokeWidth={1.75} />
                        )
                    }
                    onClick={() => setShowClosedTasks(!showClosedTasks)}
                >
                    {showClosedTasks ? "Hide closed" : "Show closed"}
                </Button>

                <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                    <Button
                        type={meMode ? "primary" : "text"}
                        size="small"
                        icon={<UserCheck size={13} strokeWidth={1.75} />}
                        onClick={() => setMeMode(!meMode)}
                    >
                        Me Mode
                    </Button>
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search address or task..."
                        prefix={
                            <Search
                                size={13}
                                strokeWidth={1.75}
                                color={tokens.colors.textMuted}
                            />
                        }
                        size="small"
                        style={{ width: 240 }}
                        allowClear
                    />
                </div>
            </div>

            <div
                style={{
                    flex: 1,
                    margin: tokens.spacing[5],
                    marginTop: tokens.spacing[3],
                    border: `1px solid ${tokens.colors.border}`,
                    borderRadius: tokens.radius.lg,
                    overflow: "hidden",
                    position: "relative",
                    minHeight: 400,
                }}
            >
                <div
                    ref={mapContainerRef}
                    style={{
                        width: "100%",
                        height: "100%",
                        position: "absolute",
                        inset: 0,
                    }}
                />

                {geocoded.length === 0 && (
                    <div
                        style={{
                            position: "absolute",
                            top: "50%",
                            left: "50%",
                            transform: "translate(-50%, -50%)",
                            background: tokens.colors.bgSurface,
                            padding: tokens.spacing[5],
                            borderRadius: tokens.radius.lg,
                            boxShadow: tokens.shadows.md,
                            zIndex: 5,
                            maxWidth: 360,
                            textAlign: "center",
                        }}
                    >
                        <EmptyState
                            icon={MapPin}
                            title="No tasks with locations"
                            description="Tasks need an Address field with a recognised Bangladesh location to appear on the map. Try the Operations → Facebook Orders list."
                            compact
                        />
                    </div>
                )}

                {/* Selected task popup */}
                {selectedTask && (
                    <div
                        style={{
                            position: "absolute",
                            top: 16,
                            left: 16,
                            background: tokens.colors.bgSurface,
                            border: `1px solid ${tokens.colors.border}`,
                            borderRadius: tokens.radius.lg,
                            boxShadow: tokens.shadows.lg,
                            padding: tokens.spacing[4],
                            width: 320,
                            zIndex: 10,
                            animation:
                                "fadeIn var(--transition-base) ease-out",
                        }}
                    >
                        <PinPopup
                            item={selectedTask}
                            onClose={() => setSelectedTask(null)}
                            onOpenTask={(taskId) => {
                                setSearchParams((prev) => {
                                    const next = new URLSearchParams(prev);
                                    next.set("task", taskId);
                                    return next;
                                });
                                setSelectedTask(null);
                            }}
                        />
                    </div>
                )}
            </div>
        </>
    );
};

// ─────────────────────────────────────────────────────────
// Pin popup card
// ─────────────────────────────────────────────────────────
const PinPopup = ({
    item,
    onClose,
    onOpenTask,
}: {
    item: GeocodedTask;
    onClose: () => void;
    onOpenTask: (taskId: string) => void;
}) => {
    const status = statusesById.get(item.task.statusId);
    return (
        <div>
            <div
                style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 6,
                    marginBottom: tokens.spacing[3],
                }}
            >
                <PriorityFlag priority={item.task.priority} size={13} />
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                        style={{
                            fontSize: 11,
                            fontFamily: tokens.typography.fontFamilyMono,
                            color: tokens.colors.textMuted,
                            marginBottom: 2,
                        }}
                    >
                        {item.task.customId ?? `T-${item.task.taskNumber}`}
                    </div>
                    <div
                        style={{
                            fontSize: tokens.typography.fontSize.base,
                            fontWeight: 600,
                            color: tokens.colors.textPrimary,
                            lineHeight: 1.3,
                        }}
                    >
                        {item.task.name}
                    </div>
                </div>
                <button
                    onClick={onClose}
                    style={{
                        background: "none",
                        border: 0,
                        cursor: "pointer",
                        color: tokens.colors.textMuted,
                        fontSize: 18,
                        lineHeight: 1,
                        padding: 0,
                    }}
                    title="Close"
                >
                    ×
                </button>
            </div>

            <div
                style={{
                    display: "flex",
                    gap: 6,
                    flexWrap: "wrap",
                    marginBottom: tokens.spacing[3],
                }}
            >
                {status && <StatusPill status={status} variant="subtle" size="sm" />}
            </div>

            <div
                style={{
                    fontSize: 12,
                    color: tokens.colors.textSecondary,
                    marginBottom: tokens.spacing[3],
                    padding: "6px 10px",
                    background: tokens.colors.bgMuted,
                    borderRadius: tokens.radius.sm,
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 4,
                }}
            >
                <MapPin
                    size={12}
                    strokeWidth={1.75}
                    style={{ marginTop: 2, flexShrink: 0 }}
                />
                <span>{item.address}</span>
            </div>

            <Button
                type="primary"
                size="small"
                block
                onClick={() => onOpenTask(item.task.id)}
            >
                Open task →
            </Button>
        </div>
    );
};
