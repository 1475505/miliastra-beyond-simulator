// Synthetic 440 Hz / 1s / mono / 8kHz MP3 (ffmpeg lavfi sine, libmp3lame 8k).
// No downloaded game audio, no encoder dependency when running tests.
export const tone = Buffer.from([
  'SUQzBAAAAAAAIlRTU0UAAAAOAAADTGF2ZjYzLjEuMTAyAAAAAAAAAAAAAAD/4xjEAA0IBuJZQQACkjQl4H/AGD4Pg+HwQBAEAQwf',
  '58Hz6BwIBjLv1AgcnP//E4IagTD+JwQdUAw/kwQ4DP8MdKqBgYYYAAH/4xjEBg6A9qzxlCgAkXiaMf8ukyZE1/jLEyAU0DE00ACt',
  'DQlMDSHR3hECh0xjf/iIdDpg8Hinf5URBUFREe/8Ff//////////4xjEBw5opjwB3gAA//////jSIRgDgBJJBcAowKwXjB/BqMIc',
  'UoxC6XDG+E2MNsFowPQPgUBeIQAwMAqhJbTt0//++BKlUCD/4xjECA3IpiwAVrxgKYkUZ9AbJyeX0YgA25x36Hmn4KmYaoLxglAL',
  'lADyBEGgAIBUvrH////f6P////Sq/+/7wLBogMLRIMD/4xjECw6ApjAAB7BIfANMFYEQw8xKTiUkdNMsOsw0ASDBVAjMCYBo0MAI',
  '0TFp4///s//p/////t//q+j///k7epdA4BMCEwL/4xjEDApYpjQABvxEmwMhwSPQYQHRBgcjAEgOoWAuAIB4YAGRACJstRv1///4',
  'BXkX1AoAx4w0Rc6Lgw2A5zexc5NEgK8wtQL/4xjEHQpQpjQABrxEIIB9DAI0EaOylLIsFf/n/DDK1AHHTkMA0BkwOgVjC1FfNpiq',
  'MzrRFTCcBUMD0CcwHAFjMYDDTAYfj///4xjELgxQpjQAB7BI///61f//+LNNQWAwKYQLmFmxi0GYJY7RmKcNGNeLkYGQN4FAoEYA',
  '6Z5EACmczW//////qf//+CWFJkr/4xjENwvwpjQABvxECYw4AzgE44wwxgVTchMXM/gDkHCnDQOgGAjC4AKdjCWfaf/v/GGdqWLe',
  'IQAgCBOYEwNxhFjSmqVkyZf/4xjEQgowpjgABrxEiKWYPQMxgXgWmAwAsZiA46VjE7L///jTOUVizJiCJj1BpMpg3i9GiVbEZLok',
  'xgrApmAiAwnqzZJFWJn/4xjEVAs4pjQAB7BIbbr4HqOJSo3A4A4aBBCAqzDmA4OC8l40kALjDFAHMEoAQwHQCwKAOIgAFlsI1f//',
  '/rIcGJBCALewMAr/4xjEYgogpjgABrxECkDAuBQDA0B8DXF9kDJuX8DG2HMDC2EEFgNho4GAsAoWHijsJAI/////3EeN12v////9',
  '02Bpiwijfrz/4xjEdAropjQAAfxAjNJpxuMpNhe2KlvzAR8DQAKV/1v4CLCiBSA5AxRK///HeSQ5CYXSXOm3//+aHETdYEIH//rA',
  'hAHQIHD/4xjEgww4pkQBVgAA///KgQ0HhxpD///3ogayzT1pqtW21lbXmjoydsuXLrnINQOoySJJ60ZPMmLzK1atdxpcaFDcQbEF',
  'cFP/4xjEjRexnowpm2gAshuIvwV0KkxBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/',
  '4xjEaQ0gtoRBzAgBqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo=',
].join(''), 'base64')
