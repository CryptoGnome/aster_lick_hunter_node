import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { configLoader } from '@/lib/config/configLoader';
import bcrypt from 'bcryptjs';

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

          // Verify password (support both hashed and plain text for backward compatibility)
          let isValid = false;
          if (effectivePassword.startsWith('$2a$') || effectivePassword.startsWith('$2b$')) {
            // Hashed password - use bcrypt
            isValid = await bcrypt.compare(credentials.password, effectivePassword);
          } else {
            // Plain text password - direct comparison (legacy support)
            isValid = credentials.password === effectivePassword;
          }

          if (!isValid) {
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
    error: '/login', // Error code passed in query string as ?error=
  },
  callbacks: {
    async redirect({ url, baseUrl }) {
      // ALWAYS redirect to root, ignore ALL callback URLs
      // This prevents localhost:3000 and other unwanted redirects
      if (url.startsWith(baseUrl)) {
        return baseUrl;
      }
      return baseUrl;
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
