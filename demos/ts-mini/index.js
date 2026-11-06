export const sum = values => values.reduce((total, value) => total + value, 0);
export const average = values => values.length ? sum(values) / values.length : 0;
// TODO: Add an optional precision argument while keeping the current default behavior.
export const formatPrice = value => `$${value.toFixed(2)}`;
