import { uniqueNamesGenerator, adjectives, animals } from "unique-names-generator";

export function generateKey(): string {
  return uniqueNamesGenerator({
    dictionaries: [adjectives, adjectives, animals],
    separator: "_",
    style: "lowerCase",
  });
}

export function generateUniqueKey(existingKeys: Set<string>): string {
  let key = generateKey();
  let attempts = 0;
  while (existingKeys.has(key) && attempts < 20) {
    key = generateKey();
    attempts++;
  }
  return key;
}
