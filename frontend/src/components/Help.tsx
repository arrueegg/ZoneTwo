import type { ReactNode } from "react";

const DEFINITIONS: Record<string, string> = {
  "A target": "Highest-priority event. The plan should peak around this date.",
  "Active calories": "Calories attributed to movement or exercise, excluding baseline resting energy.",
  "ATL": "Acute Training Load. A 7-day average of training stress, used as a fatigue estimate.",
  "Avg stress": "Average Garmin stress score for the day.",
  "Avg HR": "Average heart rate during the activity.",
  "Avg Pace": "Average moving pace per kilometre for the activity.",
  "Battery at wake": "Garmin Body Battery value around wake-up.",
  "Battery peak": "Highest Garmin Body Battery value recorded that day.",
  "Battery": "Garmin Body Battery value, usually at wake-up in summaries.",
  "Body Battery": "Garmin's estimate of available energy from stress, sleep, activity, and recovery.",
  "Cadence": "Step rate for running, usually steps per minute, or pedal revolutions per minute for cycling.",
  "CTL": "Chronic Training Load. A 42-day average of training stress, used as a fitness estimate.",
  "Distance": "Total recorded distance.",
  "Deep": "Deep sleep, generally the most physically restorative sleep stage.",
  "Elevation": "Total elevation gain recorded for the activity.",
  "Elev. +": "Positive elevation gain in this split.",
  "Endurance Score": "Garmin's long-term endurance fitness estimate.",
  "Fitness age": "Garmin's estimate of how your fitness compares with typical age ranges.",
  "Garmin Readiness": "Garmin's training readiness score from sleep, recovery, HRV, load, and stress signals.",
  "HR": "Heart rate.",
  "HR Zones": "Time distribution across heart-rate intensity zones.",
  "HRV": "Heart rate variability, usually RMSSD in milliseconds. Higher than your baseline often suggests better recovery.",
  "HRV (post)": "Heart rate variability associated with the activity or post-activity record.",
  "Long run": "The longest planned run in the week, usually kept easy to build durability.",
  "Light": "Light sleep, a normal transition and maintenance sleep stage.",
  "Max HR": "Maximum heart rate, either recorded in an activity or stored in your athlete profile.",
  "Max weekly km": "Optional cap for total planned running distance in a week.",
  "NP": "Normalized Power. A weighted cycling power estimate that reflects variable efforts better than simple average power.",
  "Pace": "Time per kilometre. Lower values mean faster running.",
  "REM": "Rapid eye movement sleep, associated with dreaming and memory consolidation.",
  "Readiness": "App-computed recovery score from available wellness signals such as HRV, sleep, stress, and body battery.",
  "Resting HR": "Resting heart rate. Elevated values can indicate fatigue, illness, heat, or stress.",
  "Resting Heart Rate": "Resting heart rate. Elevated values can indicate fatigue, illness, heat, or stress.",
  "Respiration": "Estimated breathing rate.",
  "Run days": "Number of running days the plan should use each week.",
  "Sleep": "Sleep duration or sleep score, depending on the card.",
  "Sleep score": "Garmin's sleep quality estimate from duration, stages, restlessness, and recovery signals.",
  "Sleep Stages": "Breakdown of deep, REM, light, and awake time during sleep.",
  "SpO₂": "Blood oxygen saturation estimate.",
  "Stress": "Garmin stress score derived mainly from heart-rate variability patterns.",
  "Steps": "Daily step count.",
  "Awake": "Time awake during the recorded sleep window.",
  "Target CTL": "Fitness-load goal shown on the training load chart.",
  "Target time": "Goal finish time for the event.",
  "Threshold HR": "Lactate-threshold heart rate used to estimate training stress from heart-rate data.",
  "Time": "Elapsed or moving duration, depending on the source activity record.",
  "Training Effect": "Garmin's estimate of aerobic and anaerobic fitness benefit from a workout.",
  "Training Status": "Garmin's current interpretation of fitness and load trends.",
  "TSB": "Training Stress Balance. CTL minus ATL; positive means fresher, negative means more accumulated fatigue.",
  "TSS": "Training Stress Score. Session load scaled so one hour at threshold effort is about 100.",
  "VO₂max": "Estimated maximum oxygen uptake, a common aerobic fitness marker.",
  "VO₂max est.": "Estimated VO₂max recorded for the activity.",
  "Weekly run volume": "Average running distance per week from recent activities.",
  "Z1": "Very easy intensity, useful for warm-up and recovery.",
  "Z2": "Easy aerobic endurance intensity.",
  "Z3": "Moderate aerobic intensity.",
  "Z4": "Threshold intensity, hard but controlled.",
  "Z5": "Very hard VO₂max or anaerobic intensity.",
};

export function helpText(label: string): string | undefined {
  const cleaned = label.replace(/\s+/g, " ").trim();
  const withoutParen = cleaned.replace(/\s*\(.+\)$/, "");
  const direct = DEFINITIONS[cleaned] ?? DEFINITIONS[withoutParen];
  if (direct) return direct;
  const lower = withoutParen.toLowerCase();
  const match = Object.entries(DEFINITIONS).find(([key]) => key.toLowerCase() === lower);
  return match?.[1];
}

export function HelpTerm({ children, term }: { children: ReactNode; term?: string }) {
  const text = typeof children === "string" ? children : term;
  const title = term ? helpText(term) : text ? helpText(text) : undefined;

  if (!title) return <>{children}</>;

  return (
    <span
      title={title}
      style={{
        cursor: "help",
        textDecoration: "underline dotted",
        textUnderlineOffset: 3,
      }}
    >
      {children}
    </span>
  );
}

export function labelTitle(label: string): string | undefined {
  return helpText(label);
}
