import { driver, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import './tour-theme.css';

/** Settings-DB key: presence (any value) means the user has seen or dismissed the tour. */
export const HOME_TOUR_SETTING_KEY = 'onboardingHomeTourDismissed';

/**
 * Builds and starts the first-run walkthrough over the home screen, ending
 * with a step explaining the worktree-first model (worktree → agent) that
 * picks up once a workspace is open. `onDestroyed` fires for every exit path
 * (Done, Escape, backdrop click, the X button) so dismissal is recorded no
 * matter how the user leaves it.
 */
export function startHomeTour(onDismiss: () => void): Driver {
  let dismissed = false;
  const dismissOnce = () => {
    if (dismissed) return;
    dismissed = true;
    onDismiss();
  };

  const tour = driver({
    animate: true,
    smoothScroll: true,
    allowClose: true,
    overlayColor: '#000000',
    overlayOpacity: 0.5,
    stagePadding: 8,
    stageRadius: 10,
    showProgress: true,
    progressText: '{{current}} of {{total}}',
    popoverClass: 'sg-tour-popover',
    doneBtnText: 'Got it',
    onDestroyed: () => dismissOnce(),
    steps: [
      {
        element: '[data-testid="home-start-actions"]',
        popover: {
          title: 'Start with a workspace',
          description:
            'Clone a repo, open a folder, import an existing one — or pitch an idea and let an AI agent scaffold it. Any of these creates your <strong>workspace</strong>.',
          side: 'right',
          align: 'start',
        },
      },
      {
        element: '[data-testid="recent-projects-panel"]',
        popover: {
          title: 'Come back anytime',
          description:
            'Every workspace you create or open is listed here, so switching between projects is one click away.',
          side: 'left',
          align: 'start',
        },
      },
      {
        popover: {
          title: 'Then: worktrees + agents',
          description:
            '<p>Open a workspace, and the worktree-first workflow takes over:</p>' +
            '<ol class="sg-tour-list">' +
            '<li><strong>Create a worktree</strong> for each branch you want to work on — an isolated working copy, nothing to stash or switch away from.</li>' +
            '<li><strong>Launch an AI agent</strong> right inside it. Each worktree can run its own agent, in parallel.</li>' +
            '</ol>',
        },
      },
    ],
  });

  tour.drive();

  // onDestroyed only fires once driver.js's internal per-step bookkeeping
  // (__activeStep/__activeElement) has caught up with the current step —
  // that bookkeeping finalizes on an animation-frame timer tied to the
  // ~400ms step transition, so advancing through steps faster than that
  // (e.g. scripted clicks) can leave it stale and silently skip the
  // callback even though the popover really did close. Watching for the
  // popover leaving the DOM is a reliable fallback that doesn't depend on
  // that internal timing.
  const observer = new MutationObserver(() => {
    if (!document.querySelector('.driver-popover')) {
      observer.disconnect();
      dismissOnce();
    }
  });
  observer.observe(document.body, { childList: true });

  return tour;
}
