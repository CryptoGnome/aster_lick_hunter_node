import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { configLoader } from '@/lib/config/configLoader';

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        password: { label: 'Password', type: 'password' }
      },
      async authorize(credentials) {
        if (!credentials?.password) {
          return null;
        }

        // Server-side validation
        if (credentials.password.trim().length === 0) {
          return null;
        }

        // Allow "admin" as special case, otherwise require 4+ characters
        if (credentials.password !== 'admin' && credentials.password.length < 4) {
          return null;
        }

        try {
          // Load config to check password
          const config = await configLoader.loadConfig();
          const dashboardPassword = config.global?.server?.dashboardPassword;

          // If no password is set, use default "admin"
          const effectivePassword = (!dashboardPassword || dashboardPassword.trim().length === 0)
            ? 'admin'
            : dashboardPassword;

          // Verify password
          if (credentials.password !== effectivePassword) {
            return null;
          }

          // Return user object
          return {
            id: 'authenticated',
            email: 'dashboard@aster.com',
            name: 'Dashboard User'
          };
        } catch (error) {
          console.error('Auth error:', error);
          return null;
        }
      }
    })
  ],
  pages: {
    signIn: '/login',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        (session.user as any).id = token.id as string;
      }
      return session;
    },
  },
  session: {
    strategy: 'jwt',
    maxAge: 1 * 24 * 60 * 60, // 1 days
  },
  secret: process.env.NEXTAUTH_SECRET || 'your-secret-key-change-in-production',
};
