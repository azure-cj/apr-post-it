import { Navigate, useLocation, useParams } from 'react-router-dom';
import { paths } from '../../state';

/**
 * The old "Log a post" address. Logging now sits on the listing itself,
 * under its text, so this only sends you there, keeping where you came from.
 */
export function LogPostScreen() {
  const { id = '' } = useParams();
  const location = useLocation();
  return <Navigate to={paths.property(id)} state={location.state} replace />;
}
