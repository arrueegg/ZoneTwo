import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { PlannedWorkout, SeasonPlan, SeasonPlanWeek, TrainingEvent } from "../api/client";
import { HelpTerm } from "../components/Help";
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

type WorkspaceMode = "events" | "season-plan" | "coach";

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
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("events");
  const [planOptions, setPlanOptions] = useState<PlanOptions>({
    days_per_week: 4,
    max_weekly_km: "",
    long_run_day: "Sun",
    emphasis: "balanced",
  });
  const [editableWeeks, setEditableWeeks] = useState<SeasonPlanWeek[]>([]);
  const [discussion, setDiscussion] = useState<Array<{ role: "user" | "plan"; text: string }>>([]);
  const [question, setQuestion] = useState("");

  const { data: events = [] } = useQuery<TrainingEvent[]>({
    queryKey: ["preparation-events", athleteId],
    queryFn: async () => {
      const { data } = await api.get("/preparation/events", { params: { athlete_id: athleteId } });
      return data;
    },
    enabled: Boolean(athleteId),
  });

  const { data: seasonPlan } = useQuery<SeasonPlan>({
    queryKey: ["season-plan", athleteId, planOptions],
    queryFn: async () => {
      const { data } = await api.get("/preparation/season-plan", {
        params: { athlete_id: athleteId, ...serializePlanOptions(planOptions) },
      });
      return data;
    },
    enabled: Boolean(athleteId),
  });

  const { data: plannedWorkouts = [] } = useQuery<PlannedWorkout[]>({
    queryKey: ["planned-workouts", athleteId],
    queryFn: async () => {
      const { data } = await api.get("/preparation/workouts", { params: { athlete_id: athleteId } });
      return data;
    },
    enabled: Boolean(athleteId),
  });

  useEffect(() => {
    if (!seasonPlan) return;
    setEditableWeeks(seasonPlan.weeks.map(copyWeek));
  }, [seasonPlan]);

  const createEvent = useMutation({
    mutationFn: async () => {
      const { data } = await api.post("/preparation/events", serializeForm(form), {
        params: { athlete_id: athleteId },
      });
      return data as TrainingEvent;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["preparation-events", athleteId] });
      queryClient.invalidateQueries({ queryKey: ["season-plan", athleteId] });
      setForm(initialForm);
    },
  });

  const deleteEvent = useMutation({
    mutationFn: async (eventId: string) => {
      await api.delete(`/preparation/events/${eventId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["preparation-events", athleteId] });
      queryClient.invalidateQueries({ queryKey: ["season-plan", athleteId] });
    },
  });

  const saveSeasonPlan = useMutation({
    mutationFn: async (replace: boolean) => {
      const { data } = await api.post("/preparation/season-workouts/save", {
        replace,
        weeks: editableWeeks,
      }, {
        params: { athlete_id: athleteId },
      });
      return data as PlannedWorkout[];
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["planned-workouts", athleteId] });
    },
  });

  const discussSeason = useMutation({
    mutationFn: async (message: string) => {
      const { data } = await api.post("/preparation/season-plan/discuss", {
        message,
        ...serializePlanOptions(planOptions),
      }, {
        params: { athlete_id: athleteId },
      });
      return data as { reply: string; options_patch: Partial<{ days_per_week: number; max_weekly_km: number | null; long_run_day: string; emphasis: string }> };
    },
    onSuccess: (data, message) => {
      setDiscussion((items) => [...items, { role: "user", text: message }, { role: "plan", text: data.reply }]);
      if (Object.keys(data.options_patch).length > 0) {
        setPlanOptions((options) => ({
          ...options,
          days_per_week: data.options_patch.days_per_week ?? options.days_per_week,
          max_weekly_km: data.options_patch.max_weekly_km != null ? String(data.options_patch.max_weekly_km) : options.max_weekly_km,
          long_run_day: data.options_patch.long_run_day ?? options.long_run_day,
          emphasis: data.options_patch.emphasis ?? options.emphasis,
        }));
      }
    },
  });

  const targetItems = useMemo(() => events.map((event) => ({
    ...event,
    daysLeft: daysUntil(event.event_date),
  })), [events]);
  const highConflictCount = seasonPlan?.recommendations.filter((rec) => rec.severity === "high").length ?? 0;
  const seasonStatus = highConflictCount > 0 ? "Needs attention" : events.length > 1 ? "Aligned season" : "Single target";

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
          <p style={MUTED}>One editable season plan across all upcoming targets.</p>
        </div>
        <div style={COUNTDOWN}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em" }}>Season</span>
          <strong>{events.length} target{events.length === 1 ? "" : "s"}</strong>
        </div>
      </div>

      <SeasonCommandBar
        status={seasonStatus}
        warningCount={highConflictCount}
        nextWorkout={plannedWorkouts[0] ?? null}
        onReviewConflicts={() => setWorkspaceMode("season-plan")}
      />

      <ModeSwitch mode={workspaceMode} onModeChange={setWorkspaceMode} />

      {workspaceMode === "events" && (
        <EventsWorkspace
          events={targetItems}
          form={form}
          onFormChange={setForm}
          onCreateEvent={() => createEvent.mutate()}
          creatingEvent={createEvent.isPending}
          onDeleteEvent={(eventId) => deleteEvent.mutate(eventId)}
          deletingEvent={deleteEvent.isPending}
        />
      )}

      {workspaceMode === "season-plan" && (
        <SeasonPlanWorkspace
          seasonPlan={seasonPlan ?? null}
          weeks={editableWeeks}
          onWeeksChange={setEditableWeeks}
          options={planOptions}
          onOptionsChange={setPlanOptions}
          onSaveSeasonPlan={(replace) => saveSeasonPlan.mutate(replace)}
          savingSeasonPlan={saveSeasonPlan.isPending}
        />
      )}

      {workspaceMode === "coach" && (
        <CoachWorkspace
          events={targetItems}
          discussion={discussion}
          question={question}
          onQuestionChange={setQuestion}
          onAsk={() => {
            if (!question.trim()) return;
            discussSeason.mutate(question.trim());
            setQuestion("");
          }}
          discussing={discussSeason.isPending}
        />
      )}
    </main>
  );
}

function EventsWorkspace({
  events, form, onFormChange, onCreateEvent, creatingEvent, onDeleteEvent, deletingEvent,
}: {
  events: Array<TrainingEvent & { daysLeft: number }>;
  form: EventForm;
  onFormChange: (form: EventForm) => void;
  onCreateEvent: () => void;
  creatingEvent: boolean;
  onDeleteEvent: (eventId: string) => void;
  deletingEvent: boolean;
}) {
  return (
    <section style={PANEL}>
      <div style={SECTION_HEADER}>
        <div>
          <h2 style={SECTION_TITLE}>Events</h2>
          <p style={{ ...MUTED, margin: 0 }}>Add the races and target runs the season plan should account for.</p>
        </div>
      </div>
      <TargetManager
        events={events}
        form={form}
        onFormChange={onFormChange}
        onCreateEvent={onCreateEvent}
        creatingEvent={creatingEvent}
        onDeleteEvent={onDeleteEvent}
        deletingEvent={deletingEvent}
      />
    </section>
  );
}

function SeasonPlanWorkspace({
  seasonPlan, weeks, onWeeksChange, options, onOptionsChange, onSaveSeasonPlan, savingSeasonPlan,
}: {
  seasonPlan: SeasonPlan | null;
  weeks: SeasonPlanWeek[];
  onWeeksChange: (weeks: SeasonPlanWeek[]) => void;
  options: PlanOptions;
  onOptionsChange: (options: PlanOptions) => void;
  onSaveSeasonPlan: (replace: boolean) => void;
  savingSeasonPlan: boolean;
}) {
  return (
    <section style={PANEL}>
      <div style={SECTION_HEADER}>
        <div>
          <h2 style={SECTION_TITLE}>Season Plan</h2>
          <p style={{ ...MUTED, margin: 0 }}>This is the source of truth. Edit the proposal here, then save it as future workouts.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => onSaveSeasonPlan(true)} disabled={savingSeasonPlan || weeks.length === 0} style={PRIMARY_BTN}>
            {savingSeasonPlan ? "Saving..." : "Save Edited Season"}
          </button>
        </div>
      </div>

      <PlanSettings options={options} onOptionsChange={onOptionsChange} />

      {seasonPlan?.recommendations.length ? (
        <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
          {seasonPlan.recommendations.map((rec, index) => (
            <div key={`${rec.title}-${index}`} style={rec.severity === "high" ? HIGH_WARNING : WARNINGS}>
              <strong>{rec.title}</strong>
              <p style={{ margin: "4px 0 0" }}>{rec.body}</p>
            </div>
          ))}
        </div>
      ) : null}

      {weeks.length === 0 ? (
        <div style={EMPTY_BOX}>Add an upcoming target to build a season plan.</div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {weeks.map((week, weekIndex) => (
            <EditableWeek
              key={`${week.week}-${week.starts_on}`}
              week={week}
              onChange={(nextWeek) => onWeeksChange(replaceAt(weeks, weekIndex, nextWeek))}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function TargetManager({
  events, form, onFormChange, onCreateEvent, creatingEvent, onDeleteEvent, deletingEvent,
}: {
  events: Array<TrainingEvent & { daysLeft: number }>;
  form: EventForm;
  onFormChange: (form: EventForm) => void;
  onCreateEvent: () => void;
  creatingEvent: boolean;
  onDeleteEvent: (eventId: string) => void;
  deletingEvent: boolean;
}) {
  return (
    <div style={TARGET_LAYOUT}>
      <div>
        <h3 style={SMALL_HEADING}>Targets</h3>
        {events.length === 0 && <p style={MUTED}>No upcoming events yet.</p>}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {events.map((event) => (
            <div key={event.id} style={EVENT_ROW}>
              <span>
                <strong>{event.name}</strong>
                <span style={{ display: "block", color: "#6b7280", fontSize: 12 }}>
                  {formatDate(event.event_date)} · {event.daysLeft} days · {event.priority} target
                </span>
              </span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={BADGE}>{event.target_distance_km ? `${event.target_distance_km} km` : event.event_type}</span>
                <button onClick={() => onDeleteEvent(event.id)} disabled={deletingEvent} style={SMALL_GHOST_BTN}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <details style={ADD_TARGET_PANEL}>
        <summary style={SUMMARY}>Add Target</summary>
        <form onSubmit={(event) => { event.preventDefault(); onCreateEvent(); }} style={{ ...FORM, marginTop: 14 }}>
          <Field label="Name" value={form.name} onChange={(name) => onFormChange({ ...form, name })} placeholder="City 10K" required />
          <div style={TWO_COL}>
            <Field label="Date" value={form.event_date} onChange={(event_date) => onFormChange({ ...form, event_date })} type="date" required />
            <Select label="Priority" value={form.priority} onChange={(priority) => onFormChange({ ...form, priority: priority as EventForm["priority"] })} options={["A", "B", "C"]} />
          </div>
          <div style={TWO_COL}>
            <Field label="Distance km" value={form.target_distance_km} onChange={(target_distance_km) => onFormChange({ ...form, target_distance_km })} type="number" placeholder="10" />
            <Field label="Target time" value={form.target_time} onChange={(target_time) => onFormChange({ ...form, target_time })} placeholder="45:00" />
          </div>
          <Select label="Type" value={form.event_type} onChange={(event_type) => onFormChange({ ...form, event_type })} options={["race", "time trial", "long run", "trail"]} />
          <Field label="Notes" value={form.notes} onChange={(notes) => onFormChange({ ...form, notes })} placeholder="Rolling course, tune-up race" />
          <button type="submit" disabled={!form.name || !form.event_date || creatingEvent} style={PRIMARY_BTN}>
            {creatingEvent ? "Adding..." : "Add Target"}
          </button>
        </form>
      </details>
    </div>
  );
}

function EditableWeek({ week, onChange }: { week: SeasonPlanWeek; onChange: (week: SeasonPlanWeek) => void }) {
  return (
    <article style={SEASON_WEEK}>
      <div style={{ minWidth: 110 }}>
        <strong>Week {week.week}</strong>
        <span style={{ display: "block", color: "#6b7280", fontSize: 12 }}>{formatDate(week.starts_on)}</span>
        <span style={{ display: "block", color: "#6b7280", fontSize: 12 }}>{week.primary_event_name}</span>
      </div>
      <div style={{ flex: 1, display: "grid", gap: 10 }}>
        <div style={EDIT_GRID}>
          <label style={LABEL}>
            Focus
            <input value={week.focus} onChange={(event) => onChange({ ...week, focus: event.target.value })} style={INPUT} />
          </label>
          <label style={LABEL}>
            Target km
            <input type="number" value={week.target_km} onChange={(event) => onChange({ ...week, target_km: Number(event.target.value) })} style={INPUT} />
          </label>
          <label style={LABEL}>
            Long run
            <input type="number" value={week.long_run_km} onChange={(event) => onChange({ ...week, long_run_km: Number(event.target.value) })} style={INPUT} />
          </label>
        </div>
        <label style={LABEL}>
          Note
          <input value={week.adjustment_note} onChange={(event) => onChange({ ...week, adjustment_note: event.target.value })} style={INPUT} />
        </label>
        {week.supporting_events.length > 0 && (
          <p style={{ ...MUTED, margin: 0 }}>Also in view: {week.supporting_events.join(", ")}</p>
        )}
        <div style={{ display: "grid", gap: 8 }}>
          {week.workouts.map((workout, workoutIndex) => (
            <div key={`${week.week}-${workoutIndex}`} style={WORKOUT_EDIT_ROW}>
              <select
                value={workout.day}
                onChange={(event) => onChange({ ...week, workouts: replaceAt(week.workouts, workoutIndex, { ...workout, day: event.target.value }) })}
                style={INPUT}
              >
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <option key={day} value={day}>{day}</option>)}
              </select>
              <input
                value={workout.type}
                onChange={(event) => onChange({ ...week, workouts: replaceAt(week.workouts, workoutIndex, { ...workout, type: event.target.value }) })}
                style={INPUT}
              />
              <input
                value={workout.title}
                onChange={(event) => onChange({ ...week, workouts: replaceAt(week.workouts, workoutIndex, { ...workout, title: event.target.value }) })}
                style={{ ...INPUT, minWidth: 160 }}
              />
              <input
                type="number"
                value={workout.distance_km}
                onChange={(event) => onChange({ ...week, workouts: replaceAt(week.workouts, workoutIndex, { ...workout, distance_km: Number(event.target.value) }) })}
                style={{ ...INPUT, width: 90 }}
              />
              <input
                value={workout.description}
                onChange={(event) => onChange({ ...week, workouts: replaceAt(week.workouts, workoutIndex, { ...workout, description: event.target.value }) })}
                style={{ ...INPUT, flex: 1, minWidth: 220 }}
              />
              <button
                onClick={() => onChange({ ...week, workouts: week.workouts.filter((_, index) => index !== workoutIndex) })}
                style={SMALL_GHOST_BTN}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            onClick={() => onChange({
              ...week,
              workouts: [...week.workouts, { day: "Tue", type: "easy", title: "Easy run", distance_km: 5, description: "Easy aerobic run." }],
            })}
            style={GHOST_BTN}
          >
            Add Workout
          </button>
        </div>
      </div>
    </article>
  );
}

function CoachWorkspace({
  events, discussion, question, onQuestionChange, onAsk, discussing,
}: {
  events: Array<TrainingEvent & { daysLeft: number }>;
  discussion: Array<{ role: "user" | "plan"; text: string }>;
  question: string;
  onQuestionChange: (value: string) => void;
  onAsk: () => void;
  discussing: boolean;
}) {
  return (
    <section style={PANEL}>
      <div style={SECTION_HEADER}>
        <div>
          <h2 style={SECTION_TITLE}>Coach</h2>
          <p style={{ ...MUTED, margin: 0 }}>Talk about the whole season. If the coach suggests a setting change, it is applied to the season plan.</p>
        </div>
      </div>
      {events.length > 0 && (
        <p style={{ ...MUTED, marginTop: 0 }}>
          Current season: {events.map((event) => event.name).join(", ")}
        </p>
      )}
      <div style={DISCUSS_BOX}>
        {discussion.length === 0 && (
          <p style={{ ...MUTED, margin: 0 }}>Try: “make the next block easier”, “move long runs to Saturday”, or “I can only run 3 days”.</p>
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
            placeholder="I feel tired this week. What should change in the season plan?"
            style={{ ...INPUT, flex: 1 }}
          />
          <button onClick={onAsk} disabled={discussing || !question.trim()} style={PRIMARY_BTN}>
            {discussing ? "Thinking..." : "Ask"}
          </button>
        </div>
      </div>
    </section>
  );
}

function ModeSwitch({ mode, onModeChange }: { mode: WorkspaceMode; onModeChange: (mode: WorkspaceMode) => void }) {
  const items: Array<{ mode: WorkspaceMode; title: string; description: string }> = [
    { mode: "events", title: "Events", description: "Add and manage targets" },
    { mode: "season-plan", title: "Season Plan", description: "Edit and save the real plan" },
    { mode: "coach", title: "Coach", description: "Discuss the whole season" },
  ];

  return (
    <div style={MODE_SWITCH}>
      {items.map((item) => (
        <button key={item.mode} onClick={() => onModeChange(item.mode)} style={mode === item.mode ? ACTIVE_MODE_BTN : MODE_BTN}>
          <strong>{item.title}</strong>
          <span>{item.description}</span>
        </button>
      ))}
    </div>
  );
}

function SeasonCommandBar({
  status, warningCount, nextWorkout, onReviewConflicts,
}: {
  status: string;
  warningCount: number;
  nextWorkout: PlannedWorkout | null;
  onReviewConflicts: () => void;
}) {
  return (
    <section style={COMMAND_BAR}>
      <div>
        <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em" }}>Current plan</span>
        <strong style={{ display: "block", fontSize: 18 }}>Season preparation</strong>
        <span style={MUTED}>One editable plan for all upcoming targets.</span>
      </div>
      <div style={COMMAND_META}>
        <span style={warningCount > 0 ? DANGER_BADGE : GOOD_BADGE}>{status}</span>
        {nextWorkout && <span style={BADGE}>Next saved: {formatDate(nextWorkout.planned_date)} · {nextWorkout.title}</span>}
        {warningCount > 0 && <button onClick={onReviewConflicts} style={GHOST_BTN}>Review conflicts</button>}
      </div>
    </section>
  );
}

function PlanSettings({ options, onOptionsChange }: { options: PlanOptions; onOptionsChange: (options: PlanOptions) => void }) {
  return (
    <section style={PLAN_SETTINGS}>
      <div>
        <h2 style={SECTION_TITLE}>Plan Settings</h2>
        <p style={{ ...MUTED, margin: 0 }}>Changing these regenerates the proposal. Manual workout edits happen below.</p>
      </div>
      <div style={CONTROL_GRID}>
        <label style={LABEL}>
          Run days
          <input type="number" min={3} max={7} value={options.days_per_week} onChange={(event) => onOptionsChange({ ...options, days_per_week: Number(event.target.value) })} style={INPUT} />
        </label>
        <label style={LABEL}>
          Max weekly km
          <input type="number" min={1} value={options.max_weekly_km} onChange={(event) => onOptionsChange({ ...options, max_weekly_km: event.target.value })} placeholder="No cap" style={INPUT} />
        </label>
        <Select label="Long run day" value={options.long_run_day} onChange={(long_run_day) => onOptionsChange({ ...options, long_run_day })} options={["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]} />
        <Select label="Emphasis" value={options.emphasis} onChange={(emphasis) => onOptionsChange({ ...options, emphasis })} options={["balanced", "speed", "endurance", "conservative"]} />
      </div>
    </section>
  );
}

function Field({ label, value, onChange, type = "text", placeholder, required }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label style={LABEL}>
      <HelpTerm>{label}</HelpTerm>
      <input required={required} type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} style={INPUT} />
    </label>
  );
}

function Select({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <label style={LABEL}>
      <HelpTerm>{label}</HelpTerm>
      <select value={value} onChange={(event) => onChange(event.target.value)} style={INPUT}>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function copyWeek(week: SeasonPlanWeek): SeasonPlanWeek {
  return { ...week, workouts: week.workouts.map((workout) => ({ ...workout })) };
}

function replaceAt<T>(items: T[], index: number, value: T): T[] {
  return items.map((item, itemIndex) => itemIndex === index ? value : item);
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

const PAGE: React.CSSProperties = { maxWidth: 1180, margin: "0 auto", padding: "24px 16px", fontFamily: "sans-serif" };
const TITLE: React.CSSProperties = { margin: "0 0 6px", fontSize: 28 };
const SECTION_TITLE: React.CSSProperties = { fontSize: 15, fontWeight: 700, margin: "0 0 12px" };
const MUTED: React.CSSProperties = { color: "#6b7280", fontSize: 14 };
const PANEL: React.CSSProperties = { border: "1px solid #e5e7eb", borderRadius: 8, padding: 14, background: "#fff" };
const TARGET_LAYOUT: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 14, alignItems: "start", marginBottom: 14 };
const ADD_TARGET_PANEL: React.CSSProperties = { border: "1px solid #e5e7eb", borderRadius: 8, padding: 14, background: "#f9fafb" };
const COMMAND_BAR: React.CSSProperties = { border: "1px solid #dbeafe", borderRadius: 8, padding: 14, marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap", background: "#f8fbff" };
const COMMAND_META: React.CSSProperties = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" };
const PLAN_SETTINGS: React.CSSProperties = { border: "1px solid #e5e7eb", borderRadius: 8, padding: 14, marginBottom: 14, display: "grid", gap: 12, background: "#fff" };
const MODE_SWITCH: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: 10, marginBottom: 14 };
const MODE_BTN: React.CSSProperties = { background: "#fff", color: "#374151", border: "1px solid #d1d5db", borderRadius: 8, padding: "12px 14px", cursor: "pointer", textAlign: "left", display: "grid", gap: 3 };
const ACTIVE_MODE_BTN: React.CSSProperties = { ...MODE_BTN, background: "#e8f3ff", color: "#1f5f99", borderColor: "#3B8BD4" };
const SECTION_HEADER: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 14, alignItems: "flex-start", marginBottom: 12, flexWrap: "wrap" };
const TWO_COL: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10 };
const SMALL_HEADING: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: "#374151", margin: "0 0 10px" };
const SUMMARY: React.CSSProperties = { cursor: "pointer", fontSize: 15, fontWeight: 700, color: "#111827" };
const FORM: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 12 };
const LABEL: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 5, color: "#374151", fontSize: 13, fontWeight: 600 };
const INPUT: React.CSSProperties = { border: "1px solid #d1d5db", borderRadius: 6, padding: "9px 10px", fontSize: 14, fontWeight: 400, background: "#fff" };
const PRIMARY_BTN: React.CSSProperties = { background: "#3B8BD4", color: "#fff", border: 0, borderRadius: 6, padding: "10px 14px", fontWeight: 700, cursor: "pointer" };
const GHOST_BTN: React.CSSProperties = { background: "#fff", color: "#374151", border: "1px solid #d1d5db", borderRadius: 6, padding: "8px 12px", cursor: "pointer" };
const SMALL_GHOST_BTN: React.CSSProperties = { ...GHOST_BTN, padding: "5px 8px", fontSize: 12 };
const EVENT_ROW: React.CSSProperties = { border: "1px solid #e5e7eb", borderRadius: 8, padding: "12px", textAlign: "left", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" };
const BADGE: React.CSSProperties = { border: "1px solid #d1d5db", borderRadius: 6, padding: "3px 7px", color: "#374151", fontSize: 12, background: "#fff", whiteSpace: "nowrap" };
const GOOD_BADGE: React.CSSProperties = { border: "1px solid #86efac", borderRadius: 6, padding: "4px 8px", color: "#166534", fontSize: 12, background: "#f0fdf4", fontWeight: 700, whiteSpace: "nowrap" };
const DANGER_BADGE: React.CSSProperties = { border: "1px solid #fca5a5", borderRadius: 6, padding: "4px 8px", color: "#991b1b", fontSize: 12, background: "#fef2f2", fontWeight: 700, whiteSpace: "nowrap" };
const COUNTDOWN: React.CSSProperties = { border: "1px solid #e5e7eb", borderRadius: 8, padding: "10px 14px", display: "flex", flexDirection: "column", gap: 3, minWidth: 110 };
const WARNINGS: React.CSSProperties = { border: "1px solid #fbbf24", borderRadius: 8, background: "#fffbeb", color: "#92400e", padding: 12, display: "grid", gap: 6, marginBottom: 12, fontSize: 13 };
const HIGH_WARNING: React.CSSProperties = { border: "1px solid #f87171", borderRadius: 8, background: "#fef2f2", color: "#991b1b", padding: 12, display: "grid", gap: 6, marginBottom: 12, fontSize: 13 };
const CONTROL_GRID: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, border: "1px solid #e5e7eb", borderRadius: 8, padding: 14 };
const SEASON_WEEK: React.CSSProperties = { border: "1px solid #e5e7eb", borderRadius: 8, padding: 12, display: "flex", gap: 12, alignItems: "flex-start", background: "#fff" };
const EDIT_GRID: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(180px, 1fr) 110px 110px", gap: 8 };
const WORKOUT_EDIT_ROW: React.CSSProperties = { border: "1px solid #f3f4f6", borderRadius: 8, padding: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" };
const DISCUSS_BOX: React.CSSProperties = { border: "1px solid #e5e7eb", borderRadius: 8, padding: 14, display: "grid", gap: 10 };
const USER_MSG: React.CSSProperties = { justifySelf: "end", maxWidth: "85%", background: "#e0f2fe", color: "#075985", borderRadius: 8, padding: "8px 10px", fontSize: 13 };
const PLAN_MSG: React.CSSProperties = { justifySelf: "start", maxWidth: "85%", background: "#f3f4f6", color: "#374151", borderRadius: 8, padding: "8px 10px", fontSize: 13 };
const EMPTY_BOX: React.CSSProperties = { border: "1px dashed #d1d5db", borderRadius: 8, padding: 14, color: "#6b7280", fontSize: 13 };
