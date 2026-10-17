(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MKNavigationIcons = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  const choices = Object.freeze([
    Object.freeze({ id: 'dot', label: 'Red dot' }),
    Object.freeze({ id: 'arrow', label: 'Arrow' }),
    Object.freeze({ id: 'cyclist', label: 'Cyclist' }),
    Object.freeze({ id: 'cow', label: 'Concrete Cow' })
  ]);

  // Constant, local artwork: saved settings cannot introduce SVG markup or URLs.
  const artwork = Object.freeze({
    dot: '<circle cx="32" cy="32" r="15" fill="currentColor" stroke="white" stroke-width="5"/>',
    arrow: '<path d="M29.3 8.3a3 3 0 0 1 5.4 0l18.2 43.1c1.1 2.6-1.6 5.2-4.1 4L32 47.5l-16.8 7.9c-2.5 1.2-5.2-1.4-4.1-4Z" fill="currentColor" stroke="white" stroke-width="4" stroke-linejoin="round"/>',
    cyclist: '<g fill="none" stroke="white" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"><circle cx="15" cy="46" r="10"/><circle cx="49" cy="46" r="10"/><path d="m15 46 8-17 12 17H15l15-15 19 15-6-20h-6"/></g><g fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><circle cx="15" cy="46" r="10"/><circle cx="49" cy="46" r="10"/><path d="m15 46 8-17 12 17H15l15-15 19 15-6-20h-6"/></g><path d="m31 20-7 9 11 6-6 9m2-24 9 6 5-1" fill="none" stroke="white" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><path d="m31 20-7 9 11 6-6 9m2-24 9 6 5-1" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="36" cy="11" r="6" fill="currentColor" stroke="white" stroke-width="3"/>',
    // The foreground concrete cow: blunt face, forehead blaze and a bulky
    // three-quarter body. Broad patches remain visible at navigation-marker size.
    cow: '<path d="M13 11C8 10 5 13 3 18c-2 4 0 6 3 8l1 8c-3 5 0 8 5 8 2 0 4-1 6-2l1 7-1 6c-1 3 2 4 5 3l2-1-1-11 7 1c3 4 3 7 1 12-1 3 3 4 6 3 2-1 2-3 2-5l2-11 9-5c3 2 3 5 2 8s3 4 6 3c2-1 1-3 1-5l2-7-2-8V22c-1-5-2-9-5-10l-12-2-10 1C27 7 19 5 16 8Z" fill="currentColor" stroke="white" stroke-width="3.5" stroke-linejoin="round"/><path d="M13 15c4-2 8-1 13 1l1 3c-4 0-7 4-7 8l-2 6v5c-2 2-5 3-8 2-3 0-4-2-3-4l5-5c3-3 1-9 0-12-1-2-2-2 1-4Zm21-4c5 0 10 2 12 6 2 3-1 5 0 9l4 10c1 4-4 6-8 8l-2 12c0 3-2 4-5 3 2-5 1-10-1-14l3-11c3-7-1-10 0-15 0-3-1-6-3-8Zm11 1 10 1c2 1 3 2 3 4l-3 1-3-1-3 1-4-3Zm10 14c-4 1-3 5-3 8l2 4 5 9 1-8-2-8V25Zm-36 8c3 3 8 4 12 2l1 9-7-1c-3 0-5-3-6-9Z" fill="white"/><path d="M8 25c0-2 2-3 3-3 2 1 1 3-1 4Zm13 0c1-2 3-3 5-2 0 2-2 4-4 3Z" fill="white"/><g fill="currentColor"><ellipse cx="10" cy="24" rx=".8" ry="1"/><ellipse cx="23.5" cy="24.4" rx=".8" ry="1"/><path d="M7 37c2-1 3 1 4 3-2 0-3-1-4-3Zm9 2c0-2 1-3 3-3 0 2-1 3-3 3Z"/></g>'
  });

  function normalise(value) {
    return typeof value === 'string' && choices.some(choice => choice.id === value) ? value : 'dot';
  }

  function svg(value) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true" focusable="false">' + artwork[normalise(value)] + '</svg>';
  }

  return Object.freeze({ choices, normalise, svg });
});
