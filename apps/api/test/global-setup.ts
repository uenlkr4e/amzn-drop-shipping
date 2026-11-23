import { prepareTestDatabase } from '@dropship/database/testing';

export default async function setup() {
  await prepareTestDatabase();
}
