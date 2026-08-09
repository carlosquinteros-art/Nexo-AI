/**
 * NEXO — Tipos de la base de datos
 * Escritos a mano para reflejar `db/01-schema.sql`.
 *
 * Para regenerarlos desde el proyecto real:
 *   npx supabase gen types typescript --project-id <ref> --schema public \
 *     > src/types/database.types.ts
 *
 * Convención: cada tabla expone Row (lo que llega), Insert (lo que se envía al
 * crear) y Update (lo que se envía al modificar). Las columnas con valor por
 * defecto son opcionales en Insert.
 */

/* ---------------------------------------------------------------- Enums --- */
export type SpaceType = 'work' | 'university' | 'personal';
export type PriorityLevel = 'low' | 'medium' | 'high' | 'urgent';
export type TaskStatus = 'pending' | 'in_progress' | 'waiting' | 'done' | 'cancelled';
export type RecurrenceType = 'none' | 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly';
export type BrandStatus = 'on_track' | 'needs_attention' | 'critical';
export type StoreStatus = 'active' | 'uncovered' | 'closed';
export type PersonStatus = 'active' | 'sick_leave' | 'vacation' | 'replacement' | 'resigned' | 'inactive';
export type PersonEventType = 'onboarding' | 'sick_leave' | 'vacation' | 'replacement' | 'resignation' | 'training' | 'warning';
export type RequestStatus = 'open' | 'in_progress' | 'answered' | 'closed' | 'no_reply';
export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';
export type IncidentStatus = 'open' | 'in_progress' | 'resolved';
export type MeetingStatus = 'scheduled' | 'done' | 'cancelled';
export type AgreementType = 'agreement' | 'incident' | 'finding' | 'opportunity';
export type AgreementStatus = 'open' | 'in_progress' | 'closed';
export type ImpactLevel = 'low' | 'medium' | 'high';
export type MessageAudience = 'team' | 'client' | 'hr' | 'supplier' | 'other';
export type MessageTone = 'warm' | 'executive' | 'firm' | 'motivational' | 'brief';
export type AssessmentType = 'quiz' | 'test' | 'exam' | 'paper' | 'presentation' | 'workshop' | 'oral_exam';
/* --- Universidad (migración 03) --- */
export type PreparationLevel = 'not_started' | 'reading' | 'practicing' | 'ready';
export type ValidityStatus = 'to_verify' | 'in_force' | 'amended' | 'repealed';
export type FocusLevel = 'low' | 'medium' | 'high';
export type SessionOutcome = 'pending' | 'completed' | 'partial' | 'interrupted';
export type ReviewResult = 'correct' | 'incorrect' | 'partial' | 'skipped';
export type AssessmentStatus = 'pending' | 'taken' | 'graded' | 'cancelled';
export type MasteryLevel = 'not_started' | 'initial' | 'in_progress' | 'mastered';
export type StudyPlanStatus = 'active' | 'completed' | 'cancelled';
export type StudySessionType = 'study' | 'review' | 'practice' | 'summary';
export type StudySessionStatus = 'pending' | 'done' | 'rescheduled' | 'skipped';
export type NoteType = 'note' | 'class_note' | 'idea' | 'minutes';
export type LegalSourceType = 'law' | 'code' | 'decree' | 'ruling' | 'doctrine' | 'other';
export type VerificationStatus = 'unverified' | 'verified' | 'disputed';
export type QuestionType = 'flashcard' | 'multiple_choice' | 'open';
export type ReminderChannel = 'in_app' | 'email' | 'push';
export type ThemePref = 'light' | 'dark' | 'system';
export type ActivityAction = 'create' | 'update' | 'delete' | 'restore';
export type EntityKind =
  | 'task' | 'note' | 'brand' | 'store' | 'person' | 'contact' | 'incident' | 'meeting'
  | 'agreement' | 'request' | 'course' | 'course_unit' | 'assessment' | 'reading'
  | 'study_plan' | 'study_session' | 'legal_source' | 'legal_note' | 'legal_concept'
  | 'flashcard' | 'practice_question' | 'case_brief' | 'personal_event' | 'time_block';

/* ------------------------------------------------------------- Utilidades - */
export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

/** Columnas que la base de datos gestiona sola. */
export type Managed = 'id' | 'user_id' | 'created_at' | 'updated_at';

export interface BaseRow {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
}
export interface SoftDeletable {
  deleted_at: string | null;
}

/** Estructuras JSON que guardamos en columnas jsonb. */
export interface LinkItem { title: string; url: string }
export interface ScheduleSlot { day: number; start: string; end: string }
export interface BibliographyItem { title: string; author?: string; required?: boolean }
export interface ChoiceOption { text: string; correct: boolean }
export interface AvailabilitySlot { day: number; start: string; end: string }
export interface WorkSchedule { start: string; end: string; days: number[] }
export interface NotificationPrefs {
  tasks: boolean; events: boolean; assessments: boolean; sessions: boolean; lead_minutes: number;
}

/* ------------------------------------------------------------ Perfil ------ */
export interface Profile {
  id: string;
  full_name: string;
  email: string | null;
  avatar_url: string | null;
  headline: string | null;
  timezone: string;
  onboarded: boolean;
  created_at: string;
  updated_at: string;
}
export type ProfileUpdate = Partial<Pick<Profile, 'full_name' | 'avatar_url' | 'headline' | 'timezone' | 'onboarded'>>;

export interface UserSettings {
  user_id: string;
  theme: ThemePref;
  locale: string;
  timezone: string;
  /** Escala de notas configurable. Por defecto la chilena 1,0 – 7,0. */
  pass_grade: number;
  max_grade: number;
  min_grade: number;
  grade_decimals: number;
  grade_scale_name: string;
  weekly_study_goal_min: number;
  work_schedule: WorkSchedule;
  study_availability: AvailabilitySlot[];
  notifications: NotificationPrefs;
  privacy: { store_minimal_people_data: boolean };
  created_at: string;
  updated_at: string;
}
export type UserSettingsUpdate = Partial<Omit<UserSettings, 'user_id' | 'created_at' | 'updated_at'>>;

/* ------------------------------------------------------------- Trabajo ---- */
export interface Brand extends BaseRow, SoftDeletable {
  name: string;
  client_name: string | null;
  category: string | null;
  status: BrandStatus;
  color: string;
  notes: string | null;
  documents: LinkItem[];
  is_active: boolean;
}
export interface Contact extends BaseRow, SoftDeletable {
  brand_id: string | null;
  full_name: string;
  role_title: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
}
export interface Store extends BaseRow, SoftDeletable {
  brand_id: string | null;
  name: string;
  chain: string | null;
  city: string | null;
  region: string | null;
  format: string | null;
  status: StoreStatus;
  notes: string | null;
}
export interface Person extends BaseRow, SoftDeletable {
  brand_id: string | null;
  store_id: string | null;
  full_name: string;
  role_title: string | null;
  shift: string | null;
  phone: string | null;
  email: string | null;
  status: PersonStatus;
  started_on: string | null;
}
export interface PersonEvent extends BaseRow {
  person_id: string;
  type: PersonEventType;
  starts_on: string;
  ends_on: string | null;
  replaces_id: string | null;
  note: string | null;
}
export interface Request extends BaseRow, SoftDeletable {
  brand_id: string | null;
  title: string;
  detail: string | null;
  requested_to: string | null;
  channel: string | null;
  requested_on: string;
  committed_on: string | null;
  status: RequestStatus;
}
export interface Incident extends BaseRow, SoftDeletable {
  brand_id: string | null;
  store_id: string | null;
  person_id: string | null;
  title: string;
  description: string | null;
  severity: IncidentSeverity;
  status: IncidentStatus;
  detected_at: string;
  resolved_at: string | null;
  resolution: string | null;
}
export interface Meeting extends BaseRow, SoftDeletable {
  space: SpaceType;
  brand_id: string | null;
  title: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  link: string | null;
  objective: string | null;
  notes: string | null;
  status: MeetingStatus;
  reminder_minutes: number;
}
export interface MeetingParticipant extends BaseRow {
  meeting_id: string;
  person_id: string | null;
  contact_id: string | null;
  display_name: string;
  role_title: string | null;
  attended: boolean | null;
}
export interface Agreement extends BaseRow, SoftDeletable {
  meeting_id: string | null;
  brand_id: string | null;
  task_id: string | null;
  type: AgreementType;
  title: string;
  detail: string | null;
  owner_name: string | null;
  agreed_on: string;
  due_date: string | null;
  status: AgreementStatus;
  impact: ImpactLevel;
}
export interface MessageTemplate extends BaseRow, SoftDeletable {
  space: SpaceType;
  title: string;
  audience: MessageAudience;
  tone: MessageTone;
  body: string;
  is_favorite: boolean;
}

/* ---------------------------------------------------------- Universidad --- */
export interface AcademicPeriod extends BaseRow {
  name: string;
  starts_on: string | null;
  ends_on: string | null;
  is_current: boolean;
}
export interface Course extends BaseRow, SoftDeletable {
  period_id: string | null;
  name: string;
  code: string | null;
  professor: string | null;
  room_modality: string | null;
  schedule: ScheduleSlot[];
  bibliography: BibliographyItem[];
  links: LinkItem[];
  credits: number | null;
  color: string;
  is_active: boolean;
}
export interface CourseUnit extends BaseRow, SoftDeletable {
  course_id: string;
  name: string;
  position: number;
  difficulty: number;
  mastery: MasteryLevel;
  pages: number | null;
}
export interface ClassSession extends BaseRow, SoftDeletable {
  course_id: string;
  unit_id: string | null;
  title: string | null;
  starts_at: string;
  ends_at: string | null;
  room: string | null;
  modality: string | null;
  topic: string | null;
  notes: string | null;
  attended: boolean | null;
}
export interface Assessment extends BaseRow, SoftDeletable {
  course_id: string;
  title: string;
  type: AssessmentType;
  due_date: string | null;
  due_time: string | null;
  weight: number;
  status: AssessmentStatus;
  syllabus: string | null;
  /** Nota a la que apuntas, distinta del mínimo de aprobación. */
  target_grade: number | null;
  preparation: PreparationLevel;
  included_topics: string | null;
  documents: LinkItem[];
  location: string | null;
  duration_min: number | null;
}
export interface AssessmentTopic extends BaseRow {
  assessment_id: string;
  unit_id: string | null;
  title: string;
  description: string | null;
  position: number;
}
export interface Grade extends BaseRow {
  assessment_id: string;
  score: number;
  max_score: number;
  target_score: number | null;
  attempt: number;
  graded_on: string;
  comment: string | null;
}
export interface Reading extends BaseRow, SoftDeletable {
  course_id: string | null;
  unit_id: string | null;
  title: string;
  author: string | null;
  source_url: string | null;
  total_pages: number;
  /** Página actual. */
  pages_read: number;
  due_date: string | null;
  priority: PriorityLevel;
  /** Con el total de páginas da el tiempo estimado de lectura. */
  estimated_min_per_page: number;
  edition: string | null;
  /** true = bibliografía obligatoria; false = complementaria. */
  is_required: boolean;
  notes: string | null;
}

/** Cita textual o comentario propio sobre una lectura. */
export interface ReadingNote extends BaseRow {
  reading_id: string;
  page: number | null;
  quote: string | null;
  comment: string | null;
  is_verbatim: boolean;
}
export interface StudyPlan extends BaseRow, SoftDeletable {
  course_id: string | null;
  assessment_id: string | null;
  name: string;
  target_date: string;
  hours_per_week: number;
  status: StudyPlanStatus;
}
export interface StudySession extends BaseRow, SoftDeletable {
  plan_id: string | null;
  course_id: string | null;
  unit_id: string | null;
  assessment_id: string | null;
  reading_id: string | null;
  title: string;
  scheduled_date: string;
  scheduled_time: string | null;
  duration_min: number;
  type: StudySessionType;
  status: StudySessionStatus;
  effective_min: number;
  notes: string | null;
  /* Modo de estudio */
  objective: string | null;
  material: Array<{ tipo?: string; id?: string; titulo: string }>;
  breaks_count: number;
  focus: FocusLevel | null;
  outcome: SessionOutcome;
  next_step: string | null;
  started_at: string | null;
  ended_at: string | null;
  reading_page: number | null;
}

/** Bloque de Pomodoro dentro de una sesión. */
export interface StudyInterval extends BaseRow {
  session_id: string;
  phase: 'focus' | 'break';
  started_at: string;
  ended_at: string | null;
  minutes: number;
}

/** Bloque de disponibilidad para estudiar. */
export interface StudyAvailabilityRow extends BaseRow {
  weekday: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
  label: string | null;
}
export interface LegalSource extends BaseRow, SoftDeletable {
  course_id: string | null;
  type: LegalSourceType;
  identifier: string;
  title: string | null;
  court: string | null;
  docket: string | null;
  issued_on: string | null;
  subject_matter: string | null;
  official_url: string | null;
  summary: string | null;
  verification: VerificationStatus;
  verified_at: string | null;
  /* Legislación */
  number: string | null;
  article: string | null;
  consulted_on: string | null;
  validity: ValidityStatus;
  /** Texto que copió el usuario desde la fuente oficial. Nexo nunca lo genera. */
  recorded_text: string | null;
  /* Jurisprudencia */
  parties: string | null;
  facts: string | null;
  decision: string | null;
  reasoning: string | null;
  /** true en los datos de ejemplo, para que no se confundan con fuentes reales. */
  is_demo: boolean;
}
export interface LegalConcept extends BaseRow, SoftDeletable {
  course_id: string | null;
  source_id: string | null;
  term: string;
  definition: string;
  origin: string | null;
  verification: VerificationStatus;
}
export interface LegalNote extends BaseRow, SoftDeletable {
  source_id: string | null;
  course_id: string | null;
  unit_id: string | null;
  title: string;
  /** TEXTO ORIGINAL DEL USUARIO. No se modifica nunca. */
  body: string | null;
  quote: string | null;
  page_ref: string | null;
  verification: VerificationStatus;
  topic: string | null;
  /* Contenido derivado: se muestra siempre en una sección aparte */
  summary: string | null;
  key_concepts: string[];
  norms_mentioned: string[];
  case_law_mentioned: string[];
  tags: string[];
  derived_at: string | null;
  derived_by: 'usuario' | 'reglas' | 'ia' | null;
}
export interface Flashcard extends BaseRow, SoftDeletable {
  course_id: string | null;
  unit_id: string | null;
  concept_id: string | null;
  front: string;
  back: string;
  mastery: MasteryLevel;
  hits: number;
  misses: number;
  interval_days: number;
  next_review: string | null;
}
export interface PracticeQuestion extends BaseRow, SoftDeletable {
  course_id: string | null;
  unit_id: string | null;
  assessment_id: string | null;
  type: QuestionType;
  prompt: string;
  answer: string | null;
  options: ChoiceOption[];
  difficulty: number;
  last_result: boolean | null;
  explanation: string | null;
  hits: number;
  misses: number;
  interval_days: number;
  next_review: string | null;
  source_note_id: string | null;
}

/** Un intento de repaso, sea de ficha, pregunta o caso. */
export interface ReviewAttempt {
  id: string;
  user_id: string;
  item_type: 'flashcard' | 'practice_question' | 'case_brief';
  item_id: string;
  course_id: string | null;
  unit_id: string | null;
  result: ReviewResult;
  seconds: number;
  answered_at: string;
  created_at: string;
}
export interface CaseBrief extends BaseRow, SoftDeletable {
  course_id: string | null;
  source_id: string | null;
  title: string;
  facts: string | null;
  legal_issue: string | null;
  rules: string | null;
  /** Campo antiguo. Usa arguments_claimant y arguments_defendant. */
  arguments: string | null;
  conclusion: string | null;
  status: 'draft' | 'in_review' | 'done';
  parties: string | null;
  arguments_claimant: string | null;
  arguments_defendant: string | null;
  decision: string | null;
  reasoning: string | null;
  /** Tu análisis, separado de los hechos y de la decisión del tribunal. */
  personal_opinion: string | null;
  source_reference: string | null;
  verification: VerificationStatus;
  is_demo: boolean;
}

/* ------------------------------------------------------------ Compartidas - */
export interface Task extends BaseRow, SoftDeletable {
  space: SpaceType;
  title: string;
  description: string | null;
  category: string | null;
  assignee: string | null;
  priority: PriorityLevel;
  status: TaskStatus;
  due_at: string | null;
  brand_id: string | null;
  person_id: string | null;
  course_id: string | null;
  assessment_id: string | null;
  meeting_id: string | null;
  recurrence: RecurrenceType;
  links: LinkItem[];
  position: number;
  completed_at: string | null;
}
export interface Subtask extends BaseRow {
  task_id: string;
  title: string;
  is_done: boolean;
  position: number;
}
export interface TaskComment extends BaseRow {
  task_id: string;
  body: string;
}
export interface Note extends BaseRow, SoftDeletable {
  space: SpaceType;
  type: NoteType;
  title: string;
  content: string | null;
  brand_id: string | null;
  person_id: string | null;
  course_id: string | null;
  unit_id: string | null;
  topic: string | null;
  meeting_id: string | null;
  is_pinned: boolean;
}
export interface PersonalEvent extends BaseRow, SoftDeletable {
  title: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  notes: string | null;
  reminder_minutes: number;
}
export interface TimeBlock extends BaseRow {
  space: SpaceType;
  title: string;
  block_date: string;
  start_time: string;
  end_time: string;
  brand_id: string | null;
  course_id: string | null;
  is_done: boolean;
}
export interface Tag extends BaseRow {
  name: string;
  color: string;
  space: SpaceType | null;
}
export interface EntityTag {
  id: string;
  user_id: string;
  tag_id: string;
  entity_type: EntityKind;
  entity_id: string;
  created_at: string;
}
export interface Attachment extends BaseRow {
  entity_type: EntityKind;
  entity_id: string;
  file_name: string;
  storage_path: string | null;
  external_url: string | null;
  mime_type: string | null;
  size_bytes: number | null;
}
export interface Reminder extends BaseRow {
  entity_type: EntityKind;
  entity_id: string;
  remind_at: string;
  channel: ReminderChannel;
  message: string | null;
  sent_at: string | null;
  dismissed_at: string | null;
}
export interface ActivityLogEntry {
  id: string;
  user_id: string;
  entity_type: EntityKind;
  entity_id: string;
  action: ActivityAction;
  summary: string | null;
  diff: Json | null;
  created_at: string;
}

/* ----------------------------------------------------------- Vistas ------- */
export interface CalendarItem {
  user_id: string;
  id: string;
  kind: 'meeting' | 'class' | 'assessment' | 'study_session' | 'personal';
  space: SpaceType;
  title: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  brand_id: string | null;
  course_id: string | null;
}
export interface CourseAverage {
  user_id: string;
  course_id: string;
  name: string;
  partial_average: number | null;
  graded_weight: number;
  total_weight: number;
}
export interface BrandLoad {
  user_id: string;
  brand_id: string;
  name: string;
  status: BrandStatus;
  open_tasks: number;
  overdue_tasks: number;
  open_requests: number;
  open_incidents: number;
}
export interface UnitProgress {
  user_id: string;
  unit_id: string;
  course_id: string;
  name: string;
  difficulty: number;
  mastery: MasteryLevel;
  mastery_pct: number;
  review_attempts: number;
  review_hits: number;
  accuracy_pct: number | null;
  studied_minutes: number;
}
export interface WeakTopic extends UnitProgress {
  reinforcement_score: number;
}
export interface StudyWeek {
  user_id: string;
  week_start: string;
  sessions_total: number;
  sessions_done: number;
  effective_minutes: number;
  breaks_total: number;
}
export interface AssessmentPanel {
  user_id: string;
  assessment_id: string;
  course_id: string;
  course_name: string;
  title: string;
  type: AssessmentType;
  due_date: string | null;
  weight: number;
  preparation: PreparationLevel;
  target_grade: number | null;
  days_left: number | null;
  grade: number | null;
  plan_id: string | null;
  plan_sessions: number;
  plan_sessions_done: number;
}
export interface ReadingPending {
  user_id: string;
  course_id: string | null;
  pending_pages: number;
  overdue_readings: number;
}

/* ------------------------------------------------- Mapa de la base -------- */
type WithIO<Row, OptionalOnInsert extends keyof Row = never> = {
  Row: Row;
  Insert: Omit<Row, Managed | OptionalOnInsert> &
    Partial<Pick<Row, Extract<OptionalOnInsert, keyof Row>>> & { id?: string; user_id?: string };
  Update: Partial<Omit<Row, Managed>>;
};

export interface Database {
  public: {
    Tables: {
      profiles: { Row: Profile; Insert: Partial<Profile> & { id: string }; Update: ProfileUpdate };
      user_settings: { Row: UserSettings; Insert: Partial<UserSettings> & { user_id: string }; Update: UserSettingsUpdate };
      brands: WithIO<Brand, 'client_name' | 'category' | 'status' | 'color' | 'notes' | 'documents' | 'is_active' | 'deleted_at'>;
      contacts: WithIO<Contact, 'brand_id' | 'role_title' | 'email' | 'phone' | 'notes' | 'deleted_at'>;
      stores: WithIO<Store, 'brand_id' | 'chain' | 'city' | 'region' | 'format' | 'status' | 'notes' | 'deleted_at'>;
      people: WithIO<Person, 'brand_id' | 'store_id' | 'role_title' | 'shift' | 'phone' | 'email' | 'status' | 'started_on' | 'deleted_at'>;
      people_events: WithIO<PersonEvent, 'ends_on' | 'replaces_id' | 'note'>;
      requests: WithIO<Request, 'brand_id' | 'detail' | 'requested_to' | 'channel' | 'requested_on' | 'committed_on' | 'status' | 'deleted_at'>;
      incidents: WithIO<Incident, 'brand_id' | 'store_id' | 'person_id' | 'description' | 'severity' | 'status' | 'detected_at' | 'resolved_at' | 'resolution' | 'deleted_at'>;
      meetings: WithIO<Meeting, 'space' | 'brand_id' | 'ends_at' | 'location' | 'link' | 'objective' | 'notes' | 'status' | 'reminder_minutes' | 'deleted_at'>;
      meeting_participants: WithIO<MeetingParticipant, 'person_id' | 'contact_id' | 'role_title' | 'attended'>;
      agreements: WithIO<Agreement, 'meeting_id' | 'brand_id' | 'task_id' | 'type' | 'detail' | 'owner_name' | 'agreed_on' | 'due_date' | 'status' | 'impact' | 'deleted_at'>;
      message_templates: WithIO<MessageTemplate, 'space' | 'audience' | 'tone' | 'is_favorite' | 'deleted_at'>;
      academic_periods: WithIO<AcademicPeriod, 'starts_on' | 'ends_on' | 'is_current'>;
      courses: WithIO<Course, 'period_id' | 'code' | 'professor' | 'room_modality' | 'schedule' | 'bibliography' | 'links' | 'credits' | 'color' | 'is_active' | 'deleted_at'>;
      course_units: WithIO<CourseUnit, 'position' | 'difficulty' | 'mastery' | 'pages' | 'deleted_at'>;
      class_sessions: WithIO<ClassSession, 'unit_id' | 'title' | 'ends_at' | 'room' | 'modality' | 'topic' | 'notes' | 'attended' | 'deleted_at'>;
      assessments: WithIO<Assessment, 'type' | 'due_date' | 'due_time' | 'weight' | 'status' | 'syllabus' | 'target_grade' | 'preparation' | 'included_topics' | 'documents' | 'location' | 'duration_min' | 'deleted_at'>;
      assessment_topics: WithIO<AssessmentTopic, 'unit_id' | 'description' | 'position'>;
      grades: WithIO<Grade, 'max_score' | 'target_score' | 'attempt' | 'graded_on' | 'comment'>;
      readings: WithIO<Reading, 'course_id' | 'unit_id' | 'author' | 'source_url' | 'total_pages' | 'pages_read' | 'due_date' | 'priority' | 'estimated_min_per_page' | 'edition' | 'is_required' | 'notes' | 'deleted_at'>;
      reading_notes: WithIO<ReadingNote, 'page' | 'quote' | 'comment' | 'is_verbatim'>;
      study_intervals: WithIO<StudyInterval, 'ended_at' | 'minutes'>;
      study_availability: WithIO<StudyAvailabilityRow, 'is_active' | 'label'>;
      review_attempts: { Row: ReviewAttempt; Insert: Omit<ReviewAttempt, 'id' | 'user_id' | 'created_at'> & { user_id?: string }; Update: never };
      study_plans: WithIO<StudyPlan, 'course_id' | 'assessment_id' | 'hours_per_week' | 'status' | 'deleted_at'>;
      study_sessions: WithIO<StudySession, 'plan_id' | 'course_id' | 'unit_id' | 'assessment_id' | 'reading_id' | 'scheduled_time' | 'duration_min' | 'type' | 'status' | 'effective_min' | 'notes' | 'objective' | 'material' | 'breaks_count' | 'focus' | 'outcome' | 'next_step' | 'started_at' | 'ended_at' | 'reading_page' | 'deleted_at'>;
      legal_sources: WithIO<LegalSource, 'course_id' | 'type' | 'title' | 'court' | 'docket' | 'issued_on' | 'subject_matter' | 'official_url' | 'summary' | 'verification' | 'verified_at' | 'number' | 'article' | 'consulted_on' | 'validity' | 'recorded_text' | 'parties' | 'facts' | 'decision' | 'reasoning' | 'is_demo' | 'deleted_at'>;
      legal_concepts: WithIO<LegalConcept, 'course_id' | 'source_id' | 'origin' | 'verification' | 'deleted_at'>;
      legal_notes: WithIO<LegalNote, 'source_id' | 'course_id' | 'unit_id' | 'body' | 'quote' | 'page_ref' | 'verification' | 'topic' | 'summary' | 'key_concepts' | 'norms_mentioned' | 'case_law_mentioned' | 'tags' | 'derived_at' | 'derived_by' | 'deleted_at'>;
      flashcards: WithIO<Flashcard, 'course_id' | 'unit_id' | 'concept_id' | 'mastery' | 'hits' | 'misses' | 'interval_days' | 'next_review' | 'deleted_at'>;
      practice_questions: WithIO<PracticeQuestion, 'course_id' | 'unit_id' | 'assessment_id' | 'type' | 'answer' | 'options' | 'difficulty' | 'last_result' | 'explanation' | 'hits' | 'misses' | 'interval_days' | 'next_review' | 'source_note_id' | 'deleted_at'>;
      case_briefs: WithIO<CaseBrief, 'course_id' | 'source_id' | 'facts' | 'legal_issue' | 'rules' | 'arguments' | 'conclusion' | 'status' | 'parties' | 'arguments_claimant' | 'arguments_defendant' | 'decision' | 'reasoning' | 'personal_opinion' | 'source_reference' | 'verification' | 'is_demo' | 'deleted_at'>;
      tasks: WithIO<Task, 'space' | 'description' | 'category' | 'assignee' | 'priority' | 'status' | 'due_at' | 'brand_id' | 'person_id' | 'course_id' | 'assessment_id' | 'meeting_id' | 'recurrence' | 'links' | 'position' | 'completed_at' | 'deleted_at'>;
      subtasks: WithIO<Subtask, 'is_done' | 'position'>;
      task_comments: WithIO<TaskComment>;
      notes: WithIO<Note, 'space' | 'type' | 'content' | 'brand_id' | 'person_id' | 'course_id' | 'unit_id' | 'topic' | 'meeting_id' | 'is_pinned' | 'deleted_at'>;
      personal_events: WithIO<PersonalEvent, 'ends_at' | 'location' | 'notes' | 'reminder_minutes' | 'deleted_at'>;
      time_blocks: WithIO<TimeBlock, 'space' | 'brand_id' | 'course_id' | 'is_done'>;
      tags: WithIO<Tag, 'color' | 'space'>;
      entity_tags: { Row: EntityTag; Insert: Omit<EntityTag, 'id' | 'user_id' | 'created_at'> & { user_id?: string }; Update: never };
      attachments: WithIO<Attachment, 'storage_path' | 'external_url' | 'mime_type' | 'size_bytes'>;
      reminders: WithIO<Reminder, 'channel' | 'message' | 'sent_at' | 'dismissed_at'>;
      activity_log: { Row: ActivityLogEntry; Insert: Omit<ActivityLogEntry, 'id' | 'user_id' | 'created_at'> & { user_id?: string }; Update: never };
    };
    Views: {
      v_calendar: { Row: CalendarItem };
      v_course_average: { Row: CourseAverage };
      v_brand_load: { Row: BrandLoad };
      v_reading_pending: { Row: ReadingPending };
      v_unit_progress: { Row: UnitProgress };
      v_weak_topics: { Row: WeakTopic };
      v_study_week: { Row: StudyWeek };
      v_assessment_panel: { Row: AssessmentPanel };
    };
    Functions: {
      /* Funciones sin argumentos: se declaran igual que las genera el CLI. */
      seed_demo_data: { Args: Record<PropertyKey, never>; Returns: string };
      wipe_my_data: { Args: Record<PropertyKey, never>; Returns: string };
    };
  };
}

/* Atajos cómodos para los servicios */
export type Tables = Database['public']['Tables'];
export type TableName = keyof Tables;
export type RowOf<T extends TableName> = Tables[T]['Row'];
export type InsertOf<T extends TableName> = Tables[T]['Insert'];
export type UpdateOf<T extends TableName> = Tables[T]['Update'];
