# Training programs (Bekah / trainer-built)

Multi-day **programs** = ordered **workouts** on a calendar. Members run them from **My Programs**; trainers build under **My Created Programs**.

## Current (v1 foundation)

- SQLite tables: `training_programs`, `training_program_workouts`, `training_program_progression_rules`, `member_program_assignments`, `member_program_lift_progress`
- Workouts started from a program carry `program_assignment_id`, `program_workout_id`, `program_title` (shows on **Past Workouts**)
- **Phases** on each program workout: `DELOAD`, `VOLUME`, `HYPERTROPHY`, `POWER`, `PEAK` — progression rules are **per lift, per phase**
- On **finish workout**, if rep targets are met: load increases by the **trainer-set `step_percent`** on that lift + phase (each phase has its own rule). The app applies that % to the current load, then **rounds to the nearest 5 lb** so targets match real plates (no 142 lb bench forever). If rounding would leave the **same weight** (less than ~2.5 lb effective bump), the bar stays put and **+3 reps per set** are banked for the next time that lift appears (`extra_reps_per_set`, stacks if it happens again). When the bar does move up 5 lb, extra reps reset to 0. If `step_percent` is omitted, phase defaults apply until the trainer sets a value.
- Trainer: drag workouts between days, duplicate day ranges (`duplicate-block` API), assign to client by member ID
- Member shop: browse `is_for_sale` + `published` programs (Stripe checkout not wired yet)

## Sidebar

- **My Programs** dropdown → My Programs / Programs for Purchase
- Trainers also see **My Created Programs**

## APIs (admin/trainer session)

| Route | Purpose |
|-------|---------|
| `GET/POST /api/trainer/programs` | List / create |
| `GET/PATCH /api/trainer/programs/[id]` | Load / save metadata + workout day moves |
| `POST .../workouts` | Add workout slot |
| `POST .../assign` | Send program to client |
| `POST .../duplicate-block` | Copy day range |
| `POST .../progression-rules` | Upsert lift + phase targets |
| `GET /api/member/programs` | Member assignments |
| `GET /api/member/programs/shop` | For-sale catalog |
| `POST .../assignments/[id]/start/[workoutId]` | Materialize live workout |

## Member calendar

Assignments map **program day index** → calendar dates from `starts_on` (or assignment date). The program detail page is a **month view** with **today highlighted**, **Start today’s workout**, and tap-any-day to start.

## Next builds (recommended)

1. **Workout builder in program editor** (in progress) — reuse `trainer/my-clients/.../create-workout` UI, save `template_json` + progression rows
2. **Stripe** — product per program, `member_program_assignments.source = purchase`
3. **Duplicate single workout** + multi-week UI on calendar
4. **Member-facing progression** — toast when auto-bump happens after finish
5. **Assign from client profile** — same as single-workout send

## Progressive overload

Rules live in `training_program_progression_rules` keyed by `(program_workout_id, exercise_key, training_phase)`. Member state in `member_program_lift_progress`. Starting template weights can be blank; next session fills from `current_weight_lb` after a successful finish.