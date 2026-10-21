import { NextResponse } from 'next/server';

// POST /api/admin/setup
// Bootstrap is complete. Administrator changes go through the authenticated
// user-management endpoints; never expose the original bootstrap publicly.
export async function POST() {
  return NextResponse.json({ error: 'Administrator setup is disabled' }, { status: 410 });
}
