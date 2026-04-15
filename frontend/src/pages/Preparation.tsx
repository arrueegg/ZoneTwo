import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { PlannedWorkout, PreparationPlan, TrainingEvent } from "../api/client";
import { useAthleteContext } from "../main";

type EventForm = {
  name: string;
  event_date: string;
  event_type: string;
  target_distance_km: string;
  target_time: string;
  priority: "A" | "B" | "C";
  notes: string;
};

type PlanOptions = {
  days_per_week: number;
  max_weekly_km: string;
  long_run_day: string;
  emphasis: string;
};

const today = new Date().toISOString().slice(0, 10);

const initialForm: EventForm = {
  name: "",
  event_date: today,
  event_type: "race",
  target_distance_km: "",
  target_time: "",
  priority: "B",
  notes: "",
};

export function Preparation() {
  const { athleteId } = useAthleteContext();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<EventForm>(initialForm);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [planOptions, setPlanOptions] = useState<PlanOptions>({
    days_per_week: 4,
    max_weekly_km: "",
    long_run_day: "Sun",
    emphasis: "balanced",
  });
  const [discussion, setDiscussion] = useState<Array<{ role: "user" | "plan"; text: string }>>([]);
  const [question, setQuestion] = useState("");

  const { data: events = [], isLoading } = useQuery<TrainingEvent[]>({
    queryKey: ["preparation-events", athleteId],
    queryFn: async () => {
      const { data } = await api.get("/preparation/events", { params: { athlete_id: athleteId } });
      return data;
    },
    enabled: Boolean(athleteId),
  });

  useEffect(() => {
    if (!selectedEventId && events.length > 0) setSelectedEventId(events[0].id);
    if (selectedEventId && events.every((event) => event.id !== selectedEventId)) {
      setSelectedEventId(events[0]?.id ?? null);
    }
  }, [events, selectedEventId]);

  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? null;

  const { data: plan, isLoading: planLoading } = useQuery<PreparationPlan>({
    queryKey: ["preparation-plan", selectedEventId, planOptions],
    queryFn: async () => {
      const { data } = await api.get(`/preparation/events/${selectedEventId}/plan`, {
        params: serializePlanOptions(planOptions),
      });
      return data;
    },
    enabled: Boolean(selectedEventId),
  });

  const { data: plannedWorkouts = [] } = useQuery<PlannedWorkout[]>({
    queryKey: ["planned-workouts", selectedEventId],
    queryFn: async () => {
      const { data } = await api.get(`/preparation/events/${selectedEventId}/workouts`);
      return data;
    },
    enabled: Boolean(selectedEventId),
  });

  const discussPlan = useMutation({
    mutationFn: async (message: string) => {
      const { data } = await api.post(`/preparation/events/${selectedEventId}/discuss`, {
        message,
        ...serializePlanOptions(planOptions),
      });
      return data as { reply: string; plan: PreparationPlan };
    },
    onSuccess: (data, message) => {
      setDiscussion((items) => [...items, { role: "user", text: message }, { role: "plan", text: data.reply }]);
      queryClient.setQueryData(["preparation-plan", selectedEventId, planOptions], data.plan);
    },
  });

  const savePlan = useMutation({
    mutationFn: async (replace: boolean) => {
      const { data } = await api.post(`/preparation/events/${selectedEventId}/workouts/generate`, null, {
        params: { ...serializePlanOptions(planOptions), replace },
      });
      return data as PlannedWorkout[];
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["planned-workouts", selectedEventId] });
    },
  });

  const updateWorkout = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<PlannedWorkout> }) => {
      const { data } = await api.patch(`/preparation/workouts/${id}`, patch);
      return data as PlannedWorkout;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["planned-workouts", selectedEventId] });
    },
  });

  const createEvent = useMutation({
    mutationFn: async () => {
      const { data } = await api.post("/preparation/events", serializeForm(form), {
        params: { athlete_id: athleteId },
      });
      return data as TrainingEvent;
    },
    onSuccess: (event) => {
      queryClient.invalidateQueries({ queryKey: ["preparation-events", athleteId] });
      setSelectedEventId(event.id);
      setForm(initialForm);
    },
  });

  const deleteEvent = useMutation({
    mutationFn: async (eventId: string) => {
      await api.delete(`/preparation/events/${eventId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["preparation-events", athleteId] });
    },
  });

  const calendarItems = useMemo(() => events.map((event) => ({
    ...event,
    daysLeft: daysUntil(event.event_date),
  })), [events]);

  if (!athleteId) {
    return (
      <main style={PAGE}>
        <h1 style={TITLE}>Preparation</h1>
        <p style={MUTED}>Connect Garmin or Strava first, then add the runs you are training for.</p>
      </main>
    );
  }

  return (
    <main style={PAGE}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 24, alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <h1 style={TITLE}>Preparation</h1>
          <p style={MUTED}>Upcoming targets, current fitness, and the next training block.</p>
        </div>
        {selectedEvent && (
          <div style={COUNTDOWN}>
            <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em" }}>Next event</span>
            <strong>{daysUntil(selectedEvent.event_date)} days</strong>
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))", gap: 24, alignItems: "start" }}>
        <section>
          <h2 style={SECTION_TITLE}>Add Target</h2>
          <form onSubmit={(e) => { e.preventDefault(); createEvent.mutate(); }} style={FORM}>
            <Field label="Name" value={form.name} onChange={(name) => setForm((f) => ({ ...f, name }))} placeholder="City 10K" required />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12 }}>
              <Field label="Date" value={form.event_date} onChange={(event_date) => setForm((f) => ({ ...f, event_date }))} type="date" required />
              <Select label="Priority" value={form.priority} onChange={(priority) => setForm((f) => ({ ...f, priority: priority as EventForm["priority"] }))} options={["A", "B", "C"]} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12 }}>
              <Field label="Distance km" value={form.target_distance_km} onChange={(target_distance_km) => setForm((f) => ({ ...f, target_distance_km }))} type="number" placeholder="10" />
              <Field label="Target time" value={form.target_time} onChange={(target_time) => setForm((f) => ({ ...f, target_time }))} placeholder="45:00" />
            </div>
            <Select label="Type" value={form.event_type} onChange={(event_type) => setForm((f) => ({ ...f, event_type }))} options={["race", "time trial", "long run", "trail"]} />
            <Field label="Notes" value={form.notes} onChange={(notes) => setForm((f) => ({ ...f, notes }))} placeholder="Rolling course, tune-up race" />
            <button type="submit" disabled={!form.name || !form.event_date || createEvent.isPending} style={PRIMARY_BTN}>
              {createEvent.isPending ? "Adding..." : "Add Event"}
            </button>
          </form>

          <h2 style={{ ...SECTION_TITLE, marginTop: 28 }}>Calendar</h2>
          {isLoading && <p style={MUTED}>Loading events...</p>}
          {!isLoading && calendarItems.length === 0 && <p style={MUTED}>No upcoming events yet.</p>}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {calendarItems.map((event) => (
              <button
                key={event.id}
                onClick={() => setSelectedEventId(event.id)}
                style={{
                  ...EVENT_ROW,
                  borderColor: event.id === selectedEventId ? "#3B8BD4" : "#e5e7eb",
                  background: event.id === selectedEventId ? "#f0f7ff" : "#fff",
                }}
              >
                <span>
                  <strong>{event.name}</strong>
                  <span style={{ display: "block", color: "#6b7280", fontSize: 12 }}>
                    {formatDate(event.event_date)} · {event.daysLeft} days · {event.priority} target
                  </span>
                </span>
                <span style={BADGE}>{event.target_distance_km ? `${event.target_distance_km} km` : event.event_type}</span>
              </button>
            ))}
          </div>
        </section>

        <section>
          {!selectedEvent && <EmptyPlan />}
          {selectedEvent && planLoading && <p style={MUTED}>Building plan...</p>}
          {selectedEvent && plan && (
            <PlanView
              event={selectedEvent}
              plan={plan}
              options={planOptions}
              onOptionsChange={setPlanOptions}
              discussion={discussion}
              question={question}
              onQuestionChange={setQuestion}
              onAsk={() => {
                if (!question.trim()) return;
                discussPlan.mutate(question.trim());
                setQuestion("");
              }}
              discussing={discussPlan.isPending}
              plannedWorkouts={plannedWorkouts}
              onSavePlan={(replace) => savePlan.mutate(replace)}
              savingPlan={savePlan.isPending}
              onUpdateWorkout={(id, patch) => updateWorkout.mutate({ id, patch })}
              updatingWorkout={updateWorkout.isPending}
              onDelete={() => deleteEvent.mutate(selectedEvent.id)}
              deleting={deleteEvent.isPending}
            />
          )}
        </section>
      </div>
    </main>
  );
}

function PlanView({
  event, plan, options, onOptionsChange, discussion, question, onQuestionChange, onAsk, discussing,
  plannedWorkouts, onSavePlan, savingPlan, onUpdateWorkout, updatingWorkout, onDelete, deleting,
}: {
  event: TrainingEvent;
  plan: PreparationPlan;
  options: PlanOptions;
  onOptionsChange: (options: PlanOptions) => void;
  discussion: Array<{ role: "user" | "plan"; text: string }>;
  question: string;
  onQuestionChange: (value: string) => void;
  onAsk: () => void;
  discussing: boolean;
  plannedWorkouts: PlannedWorkout[];
  onSavePlan: (replace: boolean) => void;
  savingPlan: boolean;
  onUpdateWorkout: (id: string, patch: Partial<PlannedWorkout>) => void;
  updatingWorkout: boolean;
  onDelete: () => void;
  deleting: boolean;
}) {
  return (
    <div>
      <div style={HEADER_BAND}>
        <div>
          <h2 style={{ margin: "0 0 6px", fontSize: 22 }}>{event.name}</h2>
          <p style={{ ...MUTED, margin: 0 }}>{plan.summary.headline} {plan.summary.target}</p>
        </div>
        <button onClick={onDelete} disabled={deleting} style={GHOST_BTN}>{deleting ? "Deleting..." : "Delete"}</button>
      </div>

      <div style={METRIC_GRID}>
        <Metric label="Weekly run volume" value={`${plan.context.recent_weekly_km.toFixed(1)} km`} />
        <Metric label="Long run" value={`${plan.context.recent_long_run_km.toFixed(1)} km`} />
        <Metric label="Readiness" value={plan.context.readiness_score != null ? plan.context.readiness_score.toFixed(0) : "-"} />
        <Metric label="CTL / TSB" value={`${fmtNum(plan.context.ctl)} / ${fmtNum(plan.context.tsb)}`} />
      </div>

      {plan.summary.risk_flags.length > 0 && (
        <div style={WARNINGS}>
          {plan.summary.risk_flags.map((flag) => <p key={flag} style={{ margin: 0 }}>{flag}</p>)}
        </div>
      )}

      <h2 style={{ ...SECTION_TITLE, marginTop: 28 }}>Adjust Plan</h2>
      <div style={CONTROL_GRID}>
        <label style={LABEL}>
          Run days
          <input
            type="number"
            min={3}
            max={7}
            value={options.days_per_week}
            onChange={(event) => onOptionsChange({ ...options, days_per_week: Number(event.target.value) })}
            style={INPUT}
          />
        </label>
        <label style={LABEL}>
          Max weekly km
          <input
            type="number"
            min={1}
            value={options.max_weekly_km}
            onChange={(event) => onOptionsChange({ ...options, max_weekly_km: event.target.value })}
            placeholder="No cap"
            style={INPUT}
          />
        </label>
        <Select label="Long run day" value={options.long_run_day} onChange={(long_run_day) => onOptionsChange({ ...options, long_run_day })} options={["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]} />
        <Select label="Emphasis" value={options.emphasis} onChange={(emphasis) => onOptionsChange({ ...options, emphasis })} options={["balanced", "speed", "endurance", "conservative"]} />
      </div>

      <h2 style={{ ...SECTION_TITLE, marginTop: 28 }}>Plan</h2>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <button onClick={() => onSavePlan(false)} disabled={savingPlan} style={PRIMARY_BTN}>
          {plannedWorkouts.length ? "Keep Saved Calendar" : "Save Plan to Calendar"}
        </button>
        <button onClick={() => onSavePlan(true)} disabled={savingPlan} style={GHOST_BTN}>
          {savingPlan ? "Saving..." : "Replace Saved Calendar"}
        </button>
      </div>
      <div style={{ display: "grid", gap: 12 }}>
        {plan.weeks.map((week) => (
          <article key={week.week} style={WEEK_ROW}>
            <div style={{ minWidth: 88 }}>
              <strong>Week {week.week}</strong>
              <span style={{ display: "block", color: "#6b7280", fontSize: 12 }}>{formatDate(week.starts_on)}</span>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                <strong>{week.focus}</strong>
                <span style={BADGE}>{week.target_km} km</span>
                <span style={BADGE}>Long {week.long_run_km} km</span>
              </div>
              <p style={{ ...MUTED, margin: "0 0 10px" }}>{week.adjustment_note}</p>
              <div style={{ display: "grid", gap: 8 }}>
                {week.workouts.map((workout) => (
                  <div key={`${week.week}-${workout.type}`} style={WORKOUT_ROW}>
                    <strong>{workout.day} · {workout.title} · {workout.distance_km} km</strong>
                    <span>{workout.description}</span>
                  </div>
                ))}
              </div>
            </div>
          </article>
        ))}
      </div>

      <h2 style={{ ...SECTION_TITLE, marginTop: 28 }}>Workout Calendar</h2>
      <PlannedWorkoutCalendar
        workouts={plannedWorkouts}
        onUpdateWorkout={onUpdateWorkout}
        updating={updatingWorkout}
      />

      <h2 style={{ ...SECTION_TITLE, marginTop: 28 }}>Discuss</h2>
      <div style={DISCUSS_BOX}>
        {discussion.length === 0 && (
          <p style={{ ...MUTED, margin: 0 }}>Ask why a week is structured this way, tell the plan you are tired, or ask how to fit training into fewer days.</p>
        )}
        {discussion.map((item, index) => (
          <div key={index} style={item.role === "user" ? USER_MSG : PLAN_MSG}>
            {item.text}
          </div>
        ))}
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={question}
            onChange={(event) => onQuestionChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onAsk();
            }}
            placeholder="Why is the long run this distance?"
            style={{ ...INPUT, flex: 1 }}
          />
          <button onClick={onAsk} disabled={discussing || !question.trim()} style={PRIMARY_BTN}>
            {discussing ? "Thinking..." : "Ask"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PlannedWorkoutCalendar({
  workouts, onUpdateWorkout, updating,
}: {
  workouts: PlannedWorkout[];
  onUpdateWorkout: (id: string, patch: Partial<PlannedWorkout>) => void;
  updating: boolean;
}) {
  if (!workouts.length) {
    return (
      <div style={EMPTY_BOX}>
        Save the generated plan to turn it into editable calendar workouts.
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {workouts.map((workout) => (
        <div key={workout.id} style={CALENDAR_ROW}>
          <input
            type="date"
            value={workout.planned_date}
            onChange={(event) => onUpdateWorkout(workout.id, { planned_date: event.target.value } as Partial<PlannedWorkout>)}
            style={{ ...INPUT, minWidth: 142 }}
            disabled={updating}
          />
          <select
            value={workout.status}
            onChange={(event) => onUpdateWorkout(workout.id, { status: event.target.value as PlannedWorkout["status"] })}
            style={{ ...INPUT, minWidth: 118 }}
            disabled={updating}
          >
            {["planned", "accepted", "completed", "skipped", "moved"].map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
          <input
            value={workout.title}
            onChange={(event) => onUpdateWorkout(workout.id, { title: event.target.value })}
            style={{ ...INPUT, flex: 1, minWidth: 180 }}
            disabled={updating}
          />
          <input
            type="number"
            value={workout.distance_km ?? ""}
            onChange={(event) => onUpdateWorkout(workout.id, { distance_km: event.target.value ? Number(event.target.value) : null })}
            style={{ ...INPUT, width: 92 }}
            disabled={updating}
          />
          <span style={BADGE}>{workout.workout_type}</span>
        </div>
      ))}
    </div>
  );
}

function EmptyPlan() {
  return (
    <div style={HEADER_BAND}>
      <div>
        <h2 style={{ margin: "0 0 6px", fontSize: 22 }}>No target selected</h2>
        <p style={{ ...MUTED, margin: 0 }}>Add a race or training run to get a preparation block.</p>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={METRIC}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Field({
  label, value, onChange, type = "text", placeholder, required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label style={LABEL}>
      {label}
      <input
        required={required}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        style={INPUT}
      />
    </label>
  );
}

function Select({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <label style={LABEL}>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} style={INPUT}>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function serializeForm(form: EventForm) {
  return {
    name: form.name,
    event_date: form.event_date,
    event_type: form.event_type,
    priority: form.priority,
    target_distance_km: form.target_distance_km ? Number(form.target_distance_km) : null,
    target_time_sec: parseTime(form.target_time),
    notes: form.notes || null,
  };
}

function serializePlanOptions(options: PlanOptions) {
  return {
    days_per_week: options.days_per_week,
    max_weekly_km: options.max_weekly_km ? Number(options.max_weekly_km) : null,
    long_run_day: options.long_run_day,
    emphasis: options.emphasis,
  };
}

function parseTime(value: string): number | null {
  if (!value.trim()) return null;
  const parts = value.split(":").map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return Number(value) || null;
}

function daysUntil(dateString: string): number {
  const target = new Date(`${dateString}T00:00:00`);
  const start = new Date(`${today}T00:00:00`);
  return Math.max(0, Math.ceil((target.getTime() - start.getTime()) / 86_400_000));
}

function formatDate(dateString: string): string {
  return new Date(`${dateString}T00:00:00`).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtNum(value: number | null): string {
  return value == null ? "-" : value.toFixed(0);
}

const PAGE: React.CSSProperties = {
  maxWidth: 1180,
  margin: "0 auto",
  padding: "24px 16px",
  fontFamily: "sans-serif",
};

const TITLE: React.CSSProperties = { margin: "0 0 6px", fontSize: 28 };
const SECTION_TITLE: React.CSSProperties = { fontSize: 15, fontWeight: 700, margin: "0 0 12px" };
const MUTED: React.CSSProperties = { color: "#6b7280", fontSize: 14 };
const FORM: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 12 };
const LABEL: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 5, color: "#374151", fontSize: 13, fontWeight: 600 };
const INPUT: React.CSSProperties = { border: "1px solid #d1d5db", borderRadius: 6, padding: "9px 10px", fontSize: 14, fontWeight: 400, background: "#fff" };
const PRIMARY_BTN: React.CSSProperties = { background: "#3B8BD4", color: "#fff", border: 0, borderRadius: 6, padding: "10px 14px", fontWeight: 700, cursor: "pointer" };
const GHOST_BTN: React.CSSProperties = { background: "#fff", color: "#374151", border: "1px solid #d1d5db", borderRadius: 6, padding: "8px 12px", cursor: "pointer" };
const EVENT_ROW: React.CSSProperties = { border: "1px solid #e5e7eb", borderRadius: 8, padding: "12px", textAlign: "left", cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" };
const BADGE: React.CSSProperties = { border: "1px solid #d1d5db", borderRadius: 6, padding: "3px 7px", color: "#374151", fontSize: 12, background: "#fff", whiteSpace: "nowrap" };
const COUNTDOWN: React.CSSProperties = { border: "1px solid #e5e7eb", borderRadius: 8, padding: "10px 14px", display: "flex", flexDirection: "column", gap: 3, minWidth: 110 };
const HEADER_BAND: React.CSSProperties = { border: "1px solid #e5e7eb", borderRadius: 8, padding: 18, display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 16 };
const METRIC_GRID: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 };
const METRIC: React.CSSProperties = { border: "1px solid #e5e7eb", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: "#6b7280" };
const WARNINGS: React.CSSProperties = { border: "1px solid #fbbf24", borderRadius: 8, background: "#fffbeb", color: "#92400e", padding: 12, display: "grid", gap: 6, marginTop: 12, fontSize: 13 };
const CONTROL_GRID: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, border: "1px solid #e5e7eb", borderRadius: 8, padding: 14 };
const WEEK_ROW: React.CSSProperties = { border: "1px solid #e5e7eb", borderRadius: 8, padding: 14, display: "flex", gap: 16, alignItems: "flex-start" };
const WORKOUT_ROW: React.CSSProperties = { display: "grid", gap: 2, fontSize: 13, color: "#4b5563", borderLeft: "3px solid #bfdbfe", paddingLeft: 10 };
const DISCUSS_BOX: React.CSSProperties = { border: "1px solid #e5e7eb", borderRadius: 8, padding: 14, display: "grid", gap: 10 };
const USER_MSG: React.CSSProperties = { justifySelf: "end", maxWidth: "85%", background: "#e0f2fe", color: "#075985", borderRadius: 8, padding: "8px 10px", fontSize: 13 };
const PLAN_MSG: React.CSSProperties = { justifySelf: "start", maxWidth: "85%", background: "#f3f4f6", color: "#374151", borderRadius: 8, padding: "8px 10px", fontSize: 13 };
const EMPTY_BOX: React.CSSProperties = { border: "1px dashed #d1d5db", borderRadius: 8, padding: 14, color: "#6b7280", fontSize: 13 };
const CALENDAR_ROW: React.CSSProperties = { border: "1px solid #e5e7eb", borderRadius: 8, padding: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" };
