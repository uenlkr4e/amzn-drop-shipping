import { prepareTestDatabase } from '../src/testing';

export default async function setup() {
  await prepareTestDatabase();
}
