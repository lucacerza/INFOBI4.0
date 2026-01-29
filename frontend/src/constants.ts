/**
 * Application Constants
 *
 * Centralized location for all magic numbers and configuration values.
 * Import these instead of using hardcoded values throughout the codebase.
 */

// =============================================================================
// API Configuration
// =============================================================================
export const API_BASE_URL = '/api';

// =============================================================================
// Pagination & Data Loading
// =============================================================================
export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 50,
  PREVIEW_LIMIT: 100,
  CHART_DEFAULT_TOP_N: 50,
  MAX_ROWS_PER_REQUEST: 1000,
} as const;

// =============================================================================
// Grid Configuration
// =============================================================================
export const GRID = {
  ROW_HEIGHT: 35,
  HEADER_HEIGHT: 40,
  MIN_COLUMN_WIDTH: 100,
  DEFAULT_COLUMN_WIDTH: 150,
  VIRTUALIZATION_OVERSCAN: 5,
} as const;

// =============================================================================
// Chart Configuration
// =============================================================================
export const CHART = {
  DEFAULT_HEIGHT: 400,
  MIN_HEIGHT: 200,
  ANIMATION_DURATION: 300,
  TOOLTIP_TRIGGER_DELAY: 100,
} as const;

// =============================================================================
// UI Timing
// =============================================================================
export const TIMING = {
  DEBOUNCE_DELAY: 300,
  TOAST_DURATION: 5000,
  SKELETON_DELAY: 200,
  AUTO_SAVE_DELAY: 2000,
} as const;

// =============================================================================
// Number Formatting
// =============================================================================
export const NUMBER_FORMAT = {
  LOCALE: 'it-IT',
  CURRENCY: 'EUR',
  DECIMAL_PLACES: 2,
  COMPACT_THRESHOLD: 1000000,
} as const;

// =============================================================================
// Italian Number Abbreviations
// =============================================================================
export const NUMBER_ABBREVIATIONS = {
  THOUSANDS: 'K',
  MILLIONS: 'M',
  BILLIONS: 'Mld',  // Miliardi in Italian
  TRILLIONS: 'T',
} as const;

// =============================================================================
// Dashboard Configuration
// =============================================================================
export const DASHBOARD = {
  GRID_COLUMNS: 12,
  MIN_WIDGET_WIDTH: 2,
  MIN_WIDGET_HEIGHT: 2,
  DEFAULT_WIDGET_WIDTH: 6,
  DEFAULT_WIDGET_HEIGHT: 4,
  WIDGET_MARGIN: 10,
} as const;

// =============================================================================
// Aggregation Types
// =============================================================================
export const AGGREGATIONS = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'] as const;
export type AggregationType = typeof AGGREGATIONS[number];

// =============================================================================
// Filter Types
// =============================================================================
export const FILTER_TYPES = [
  'equals',
  'notEqual',
  'contains',
  'greaterThan',
  'greaterThanOrEqual',
  'lessThan',
  'lessThanOrEqual',
  'isNull',
  'isNotNull',
] as const;
export type FilterType = typeof FILTER_TYPES[number];

// =============================================================================
// Chart Types
// =============================================================================
export const CHART_TYPES = ['bar', 'line', 'pie', 'area', 'kpi', 'horizontal-bar'] as const;
export type ChartType = typeof CHART_TYPES[number];

// =============================================================================
// User Roles
// =============================================================================
export const USER_ROLES = {
  SUPERUSER: 'SUPERUSER',
  ADMIN: 'ADMIN',
  USER: 'USER',
} as const;
export type UserRole = typeof USER_ROLES[keyof typeof USER_ROLES];

// =============================================================================
// Error Messages (Italian)
// =============================================================================
export const ERRORS = {
  NETWORK_ERROR: 'Errore di connessione. Verifica la tua connessione internet.',
  UNAUTHORIZED: 'Sessione scaduta. Effettua nuovamente il login.',
  NOT_FOUND: 'Risorsa non trovata.',
  SERVER_ERROR: 'Errore del server. Riprova più tardi.',
  VALIDATION_ERROR: 'Dati non validi. Controlla i campi inseriti.',
} as const;

// =============================================================================
// Success Messages (Italian)
// =============================================================================
export const SUCCESS = {
  SAVED: 'Salvato con successo',
  DELETED: 'Eliminato con successo',
  CREATED: 'Creato con successo',
  UPDATED: 'Aggiornato con successo',
} as const;
