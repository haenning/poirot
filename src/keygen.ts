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
  if (existingKeys.has(key)) {
    throw new Error("Could not generate a unique key after 20 attempts");
  }
  return key;
}
