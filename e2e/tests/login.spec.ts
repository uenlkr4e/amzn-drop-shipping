import { expect, test } from '@playwright/test';
import { E2E_USER } from '../global-setup';

test('operator signs in and sees operations status', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel('Email').fill(E2E_USER.email);
  await page.getByLabel('Password').fill(E2E_USER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { name: 'Operations status' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'system', exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
});
