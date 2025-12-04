import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
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
          if (!dashboardPassword || dashboardPassword.trim().length === 0) {
            // Default password is "admin"
            if (credentials.password !== 'admin') {
              return null;
            }
          } else if (dashboardPassword.startsWith('$2a$') || dashboardPassword.startsWith('$2b$')) {
            // Password is hashed - use bcrypt compare
            const isValid = await bcrypt.compare(credentials.password, dashboardPassword);
            if (!isValid) {
              return null;
            }
          } else {
            // Plain text password (legacy support)
            if (credentials.password !== dashboardPassword) {
              return null;
            }
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
    async redirect({ url, baseUrl }) {
      // Handle relative URLs
      if (url.startsWith('/')) {
        return url;
      }
      // Handle same-origin URLs
      if (url.startsWith(baseUrl)) {
        return url;
      }
      // Extract path from URL if it's a full URL (e.g., http://localhost:3000/path)
      try {
        const urlObj = new URL(url);
        const baseUrlObj = new URL(baseUrl);
        // If the path is valid, redirect to the path on the current host
        if (urlObj.pathname) {
          return urlObj.pathname + (urlObj.search || '');
        }
      } catch {
        // Invalid URL, fall through to default
      }
      // Default to home page
      return '/';
    },
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
