import { redirect } from 'next/navigation';

// Workflows now live inside the Community members hub as a sub-tab.
// This route is kept so old links keep working.
export default function WorkflowsPage() {
  redirect('/community?tab=workflows');
}
