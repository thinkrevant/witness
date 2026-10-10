// Shared Tailwind class strings: one accent colour, 44px touch targets, visible focus rings.
const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700";

export const buttonPrimary = `inline-flex min-h-11 items-center justify-center rounded-lg bg-teal-700 px-4 py-2 font-medium text-white hover:bg-teal-800 disabled:opacity-60 ${focus}`;

export const buttonSecondary = `inline-flex min-h-11 items-center justify-center rounded-lg border border-stone-300 bg-white px-4 py-2 font-medium text-stone-800 hover:bg-stone-100 disabled:opacity-60 ${focus}`;

export const inputClass = `block w-full min-h-11 rounded-lg border border-stone-300 bg-white px-3 py-2 text-base text-stone-900 ${focus}`;

export const linkClass = `font-medium text-teal-700 underline underline-offset-2 hover:text-teal-800 ${focus}`;

export const card = "rounded-xl border border-stone-200 bg-white p-4 shadow-sm";
