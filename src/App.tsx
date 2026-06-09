import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from './auth/LoginPage';
import { RequireAuth } from './auth/RequireAuth';
import { HomePage } from './pages/HomePage';
import { ProfilePage } from './pages/ProfilePage';
import { MatchesPage } from './pages/MatchesPage';
import { NewMatchPage } from './pages/NewMatchPage';
import { MatchDetailPage } from './pages/MatchDetailPage';
import { GamesHubPage } from './pages/GamesHubPage';
import { GamePlayPage } from './pages/GamePlayPage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<RequireAuth><HomePage /></RequireAuth>} />
      <Route path="/profile" element={<RequireAuth><ProfilePage /></RequireAuth>} />
      <Route path="/matches" element={<RequireAuth><MatchesPage /></RequireAuth>} />
      <Route path="/matches/new" element={<RequireAuth><NewMatchPage /></RequireAuth>} />
      <Route path="/matches/:id" element={<RequireAuth><MatchDetailPage /></RequireAuth>} />
      <Route path="/games" element={<RequireAuth><GamesHubPage /></RequireAuth>} />
      <Route path="/games/:gameId" element={<RequireAuth><GamePlayPage /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
