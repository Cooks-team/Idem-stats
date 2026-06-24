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
import { FriendsPage } from './pages/FriendsPage';
import { LandingPage } from './pages/LandingPage';
import { JoinByCodePage } from './pages/JoinByCodePage';
import { BlackjackPage } from './pages/BlackjackPage';
import { MessagesPage } from './pages/MessagesPage';
import { AdminPage } from './pages/AdminPage';
import { RanksPage } from './pages/RanksPage';
import { ComingSoonPage } from './pages/ComingSoonPage';

export function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/about" element={<LandingPage />} />

      {/* Privé */}
      <Route path="/" element={<RequireAuth><HomePage /></RequireAuth>} />
      <Route path="/profile" element={<RequireAuth><ProfilePage /></RequireAuth>} />
      <Route path="/matches" element={<RequireAuth><MatchesPage /></RequireAuth>} />
      <Route path="/matches/new" element={<RequireAuth><NewMatchPage /></RequireAuth>} />
      <Route path="/matches/:id" element={<RequireAuth><MatchDetailPage /></RequireAuth>} />
      <Route path="/games" element={<RequireAuth><GamesHubPage /></RequireAuth>} />
      <Route path="/games/:gameId" element={<RequireAuth><GamePlayPage /></RequireAuth>} />
      <Route path="/friends" element={<RequireAuth><FriendsPage /></RequireAuth>} />
      <Route path="/messages" element={<RequireAuth><MessagesPage /></RequireAuth>} />
      <Route path="/join/:code" element={<RequireAuth><JoinByCodePage /></RequireAuth>} />
      <Route path="/blackjack" element={<RequireAuth><BlackjackPage /></RequireAuth>} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/ranks" element={<RequireAuth><RanksPage /></RequireAuth>} />
      <Route path="/coming-soon" element={<RequireAuth><ComingSoonPage /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
