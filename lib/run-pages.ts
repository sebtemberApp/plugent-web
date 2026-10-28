/** How the sidebar pages run history; shared by the server (`lib/runs.ts`, `lib/run-history.ts`)
 *  and the sidebar, which offers "Show more" only when the first read was cut. */

/** The newest runs across all agents that every page's layout reads. */
export const SIDEBAR_RUNS = 30;

/** One agent's older runs per "Show more". */
export const OLDER_RUNS_PAGE = 20;
