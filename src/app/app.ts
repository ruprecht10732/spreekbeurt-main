import { ChangeDetectionStrategy, Component, HostListener, signal, computed, effect, ViewChild, ElementRef, AfterViewInit, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Background3DComponent } from './background-3d.component';
import { SLIDES } from './slides.data';
import { animate, stagger, cubicBezier } from 'motion';
import confetti from 'canvas-confetti';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-root',
  imports: [Background3DComponent, MatIconModule],
  template: `
    <!-- Background audio for entire presentation -->
    <audio #bgAudio [src]="bgAudioSrc" loop preload="auto" class="hidden"></audio>

    <!-- Full-screen video background (behind 3D, revealed on zoom) -->
    @if (currentSlide().video) {
      <video #bgVideo
        class="fixed inset-0 w-full h-full object-cover z-[1] transition-opacity duration-1000"
        [class.opacity-0]="!videoRevealed()"
        [src]="currentSlide().video"
        loop playsinline autoplay>
      </video>
    }

    <app-background-3d 
      [slideIndex]="currentIndex()" 
      [slideId]="currentSlide().id"
      [fadeOut]="videoRevealed()"
      class="transition-opacity duration-[2000ms] ease-in-out"
      [class.opacity-0]="videoRevealed()">
    </app-background-3d>

    <div class="relative z-10 w-full h-screen overflow-hidden flex flex-col items-center justify-center pointer-events-none">
      
      <!-- Star Wars Crawl for Title Slide -->
      @if (currentSlide().isTitleSlide) {
        <div class="absolute inset-0 flex items-center justify-center perspective-[800px]">
          <div #crawlContainer class="w-[80%] max-w-3xl text-center text-[var(--color-starwars-yellow)] font-starwars transform-gpu rotate-x-[20deg] origin-bottom">
            <h1 class="text-7xl md:text-9xl mb-8 uppercase tracking-widest title-shimmer">{{ currentSlide().title }}</h1>
            @for (line of currentSlide().content; track $index) {
              <p class="text-3xl md:text-5xl mb-4 uppercase tracking-wider">{{ line }}</p>
            }
            @if (currentSlide().id === 'title' && !hasStarted()) {
              <button (click)="startPresentation()" class="mt-12 pointer-events-auto group flex flex-col items-center gap-4 mx-auto focus:outline-none">
                <div class="w-28 h-28 rounded-full bg-[var(--color-starwars-yellow)]/20 border-2 border-[var(--color-starwars-yellow)] flex items-center justify-center group-hover:bg-[var(--color-starwars-yellow)]/40 group-hover:scale-110 active:scale-95 transition-all duration-300 shadow-[0_0_40px_rgba(255,232,31,0.3)] group-hover:shadow-[0_0_60px_rgba(255,232,31,0.5)] play-pulse">
                  <mat-icon class="!text-6xl !w-14 !h-14 text-[var(--color-starwars-yellow)] ml-1" style="font-size:56px;width:56px;height:56px;">play_arrow</mat-icon>
                </div>
                <span class="text-xl opacity-70 group-hover:opacity-100 transition-opacity">Klik om te beginnen</span>
              </button>
            } @else if (currentSlide().id === 'title' && hasStarted()) {
              <p class="mt-12 text-xl opacity-70 animate-pulse">Druk op spatie of pijltje naar rechts om verder te gaan</p>
            }
          </div>
        </div>
      } @else {
        <!-- Cinematic gradient overlay on the left -->
        <div class="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-transparent pointer-events-none"></div>

        <!-- Regular Slide Content — left-aligned cinematic layout -->
        <div #slideContainer class="relative w-full h-full flex flex-col justify-center pl-12 md:pl-20 pr-[45%] pointer-events-auto">
          
          <!-- Accent line + Title -->
          <div class="mb-8">
            <div class="accent-line w-16 h-1 bg-[var(--color-starwars-yellow)] mb-5 rounded-full shadow-[0_0_12px_rgba(255,232,31,0.6)] origin-left"></div>
            <h2 class="slide-title text-4xl md:text-6xl font-starwars text-[var(--color-starwars-yellow)] uppercase tracking-wider drop-shadow-[0_0_20px_rgba(255,232,31,0.35)]">
              {{ currentSlide().title }}
            </h2>
          </div>
          
          <!-- Content items with left accent -->
          <div class="space-y-4 text-lg md:text-2xl font-sans text-gray-100 leading-relaxed pl-5 border-l-2 border-white/10">
            @for (line of currentSlide().content; track $index) {
              <p class="slide-item drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">{{ line }}</p>
            }
          </div>



          @if (currentSlide().experiment) {
            <div class="mt-10 pl-5 border-l-2 border-green-500/40 slide-item">
              <h3 class="text-2xl font-starwars text-green-400 mb-3 flex items-center gap-3 drop-shadow-[0_0_10px_rgba(74,222,128,0.4)]">
                <mat-icon>science</mat-icon> {{ currentSlide().experiment?.title }}
              </h3>
              <p class="text-green-200/80 mb-3 text-sm md:text-base">{{ currentSlide().experiment?.description }}</p>
              <ul class="space-y-2 text-green-100">
                @for (instruction of currentSlide().experiment?.instructions; track $index) {
                  <li class="flex items-start gap-2">
                    <span class="text-green-500 mt-1">&#9656;</span>
                    <span>{{ instruction }}</span>
                  </li>
                }
              </ul>
            </div>
          }

          @if (currentSlide().quiz) {
            @let quiz = currentSlide().quiz!;
            <div class="mt-10 slide-item">
              @if (currentQuizQuestionIndex() < quiz.length) {
                @let q = quiz[currentQuizQuestionIndex()];
                <div>
                  <span class="text-blue-400/80 font-starwars text-lg tracking-widest mb-4 block">Vraag {{ currentQuizQuestionIndex() + 1 }} / {{ quiz.length }}</span>
                  
                  <p class="text-2xl md:text-3xl text-white font-medium mb-8 drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">{{ q.question }}</p>
                  
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-8">
                    @for (option of q.options; track $index) {
                      <div class="quiz-option px-5 py-4 rounded-lg transition-all duration-300 flex items-center text-lg md:text-xl font-semibold"
                           [class]="isAnswerRevealed() 
                                    ? ($index === q.correctOptionIndex 
                                        ? 'bg-green-500/20 border-l-4 border-green-400 text-white shadow-[0_0_20px_rgba(74,222,128,0.3)] scale-[1.02]' 
                                        : 'bg-white/5 border-l-4 border-red-500/30 text-gray-500 opacity-50 scale-[0.98]')
                                    : 'bg-white/5 border-l-4 border-blue-400/40 text-blue-50 hover:bg-white/10'">
                        <span class="mr-3 text-sm opacity-50 font-starwars">{{ ['A','B','C','D'][$index] }}</span>
                        {{ option }}
                      </div>
                    }
                  </div>

                  @if (isAnswerRevealed()) {
                    <div class="mb-8 pl-5 border-l-2 border-green-500/40 animate-fade-in">
                      <p class="text-green-200/90 text-lg">{{ q.explanation }}</p>
                    </div>
                  }

                  <div class="flex justify-start gap-4">
                    @if (!isAnswerRevealed()) {
                      <button (click)="revealAnswer()" class="px-6 py-3 bg-[var(--color-starwars-yellow)] text-black font-starwars tracking-widest rounded-lg hover:bg-yellow-400 transition-colors shadow-[0_0_20px_rgba(255,232,31,0.3)]">
                        Toon Antwoord
                      </button>
                    } @else {
                      <button (click)="nextQuizQuestion()" class="px-6 py-3 bg-blue-500/80 text-white font-starwars tracking-widest rounded-lg hover:bg-blue-400 transition-colors">
                        {{ currentQuizQuestionIndex() === quiz.length - 1 ? 'Einde Afvalrace' : 'Volgende Vraag' }}
                      </button>
                    }
                  </div>
                </div>
              } @else {
                <div class="text-left">
                  <mat-icon class="text-6xl text-[var(--color-starwars-yellow)] mb-4 drop-shadow-[0_0_20px_rgba(255,232,31,0.5)]" style="height: 60px; width: 60px; font-size: 60px;">emoji_events</mat-icon>
                  <h3 class="text-4xl font-starwars text-[var(--color-starwars-yellow)] mb-4 tracking-widest">Gefeliciteerd!</h3>
                  <p class="text-2xl text-green-100">Jullie zijn de ultieme Jupiter-experts!</p>
                </div>
              }
            </div>
          }
        </div>
      }

      <!-- Navigation Controls -->
      <div class="absolute bottom-8 left-0 right-0 flex items-center justify-between px-12 pointer-events-auto">
        <button 
          (click)="prevSlide()" 
          [disabled]="currentIndex() === 0 || isTransitioning()"
          class="p-3 rounded-full bg-black/40 border border-white/10 text-[var(--color-starwars-yellow)] hover:bg-[var(--color-starwars-yellow)] hover:text-black hover:scale-110 active:scale-95 transition-all duration-300 disabled:opacity-20 disabled:hover:scale-100 disabled:hover:bg-black/40 disabled:hover:text-[var(--color-starwars-yellow)] backdrop-blur-sm">
          <mat-icon>chevron_left</mat-icon>
        </button>
        
        <!-- Progress Dots -->
        <div class="flex items-center gap-2">
          @for (slide of slides; track $index) {
            <div class="transition-all duration-500 rounded-full" 
                 [class]="$index === currentIndex() 
                   ? 'w-8 h-2 bg-[var(--color-starwars-yellow)] shadow-[0_0_12px_rgba(255,232,31,0.6)]' 
                   : $index < currentIndex() 
                     ? 'w-2 h-2 bg-[var(--color-starwars-yellow)]/50' 
                     : 'w-2 h-2 bg-white/20'">
            </div>
          }
        </div>

        <button 
          (click)="nextSlide()" 
          [disabled]="currentIndex() === totalSlides() - 1 || isTransitioning()"
          class="p-3 rounded-full bg-black/40 border border-white/10 text-[var(--color-starwars-yellow)] hover:bg-[var(--color-starwars-yellow)] hover:text-black hover:scale-110 active:scale-95 transition-all duration-300 disabled:opacity-20 disabled:hover:scale-100 disabled:hover:bg-black/40 disabled:hover:text-[var(--color-starwars-yellow)] backdrop-blur-sm">
          <mat-icon>chevron_right</mat-icon>
        </button>
      </div>
    </div>
  `,
  styles: [`
    :host {
      perspective: 1200px;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes shimmer {
      0%, 100% { text-shadow: 0 0 20px rgba(255, 232, 31, 0.3), 0 0 40px rgba(255, 232, 31, 0.1); }
      50% { text-shadow: 0 0 40px rgba(255, 232, 31, 0.6), 0 0 80px rgba(255, 232, 31, 0.3), 0 0 120px rgba(255, 232, 31, 0.1); }
    }
    .title-shimmer {
      animation: shimmer 3s ease-in-out infinite;
    }
    @keyframes playPulse {
      0%, 100% { box-shadow: 0 0 40px rgba(255, 232, 31, 0.3); }
      50% { box-shadow: 0 0 60px rgba(255, 232, 31, 0.6), 0 0 100px rgba(255, 232, 31, 0.2); }
    }
    .play-pulse {
      animation: playPulse 2s ease-in-out infinite;
    }
    .animate-fade-in {
      animation: fadeIn 0.5s ease-out forwards;
    }
    .perspective-1000 { perspective: 1000px; }
    .transform-style-3d { transform-style: preserve-3d; }
    .backface-hidden { backface-visibility: hidden; }
    .rotate-y-180 { transform: rotateY(180deg); }
    .perspective-\\[800px\\] {
      perspective: 800px;
    }
    .rotate-x-\\[20deg\\] {
      transform: rotateX(20deg);
    }
  `]
})
export class App implements AfterViewInit {
  slides = SLIDES;
  currentIndex = signal(0);
  currentQuizQuestionIndex = signal(0);
  isAnswerRevealed = signal(false);
  isTransitioning = signal(false);
  direction = signal<1 | -1>(1);
  videoRevealed = signal(false);
  hasStarted = signal(false);
  private videoRevealTimer: ReturnType<typeof setTimeout> | null = null;
  private isBrowser: boolean;
  private platformId = inject(PLATFORM_ID);

  currentSlide = computed(() => this.slides[this.currentIndex()]);
  totalSlides = computed(() => this.slides.length);

  @ViewChild('slideContainer') slideContainer?: ElementRef<HTMLDivElement>;
  @ViewChild('crawlContainer') crawlContainer?: ElementRef<HTMLDivElement>;
  @ViewChild('bgVideo') bgVideo?: ElementRef<HTMLVideoElement>;
  @ViewChild('bgAudio') bgAudio?: ElementRef<HTMLAudioElement>;

  bgAudioSrc = 'Interstellar Main Theme - Extra Extended - Soundtrack by Hans Zimmer - Cinémavore.mp3';

  constructor() {
    this.isBrowser = isPlatformBrowser(this.platformId);
    
    effect(() => {
      // Reset quiz state when slide changes
      const current = this.currentSlide();
      if (current.quiz) {
        this.currentQuizQuestionIndex.set(0);
        this.isAnswerRevealed.set(false);
      }
      
      // Animate new slide content
      if (this.isBrowser) {
        // Clear any pending video reveal
        if (this.videoRevealTimer) { clearTimeout(this.videoRevealTimer); this.videoRevealTimer = null; }
        this.videoRevealed.set(false);

        setTimeout(() => {
          this.animateSlideIn();
          // If slide has a video, start playback and schedule the 3D fade-out reveal
          if (current.video) {
            const vid = this.bgVideo?.nativeElement;
            if (vid) {
              if (current.id === 'h5') {
                vid.volume = 0;
                vid.muted = true;
                vid.playbackRate = 0.7;
              } else {
                vid.volume = 0.15;
                vid.muted = false;
                vid.playbackRate = 1;
              }
              vid.play().catch(() => {});
            }
            this.videoRevealTimer = setTimeout(() => this.videoRevealed.set(true), 1800);
          }
        }, 50);
      }
    });
  }

  ngAfterViewInit() {
    if (this.isBrowser) {
      this.animateSlideIn();
    }
  }

  startPresentation() {
    this.hasStarted.set(true);
    this.startBgAudio();
    // Auto-advance to the next slide after a short moment
    setTimeout(() => this.nextSlide(), 800);
  }

  private startBgAudio() {
    const audio = this.bgAudio?.nativeElement;
    if (!audio) return;
    audio.volume = 0.3;
    audio.play().catch(() => {
      // Autoplay blocked — start on first user interaction
      const resume = () => {
        audio.play().catch(() => {});
        document.removeEventListener('click', resume);
        document.removeEventListener('keydown', resume);
      };
      document.addEventListener('click', resume, { once: true });
      document.addEventListener('keydown', resume, { once: true });
    });
  }

  async animateSlideOut(dir: number) {
    if (!this.isBrowser) return;
    
    const customEase = cubicBezier(0.4, 0, 0.2, 1);
    const animations: Promise<unknown>[] = [];

    if (this.crawlContainer?.nativeElement) {
      animations.push(
        animate(
          this.crawlContainer.nativeElement,
          { 
            y: [0, dir === 1 ? '-40vh' : '40vh'],
            opacity: [1, 0],
            filter: ['blur(0px)', 'blur(16px)'],
            scale: [1, 0.8]
          },
          { duration: 0.6, ease: customEase }
        ).finished
      );
    }

    if (this.slideContainer?.nativeElement) {
      animations.push(
        animate(
          this.slideContainer.nativeElement,
          { 
            x: [0, dir === 1 ? -200 : 200],
            y: [0, dir === 1 ? -30 : 30],
            opacity: [1, 0],
            filter: ['blur(0px)', 'blur(16px)'],
            scale: [1, 0.85]
          },
          { duration: 0.6, ease: customEase }
        ).finished
      );
    }

    if (animations.length > 0) {
      await Promise.all(animations);
    }
  }

  animateSlideIn() {
    if (!this.isBrowser) return;

    const customEase = cubicBezier(0.16, 1, 0.3, 1);
    const dir = this.direction();

    if (this.crawlContainer?.nativeElement) {
      animate(
        this.crawlContainer.nativeElement,
        { 
          y: [dir === 1 ? '40vh' : '-40vh', '0vh'],
          opacity: [0, 1],
          rotateX: [40, 20],
          filter: ['blur(16px)', 'blur(0px)'],
          scale: [0.8, 1]
        },
        { duration: 1.2, ease: 'easeOut' }
      ).finished.then(() => this.isTransitioning.set(false));
    }

    if (this.slideContainer?.nativeElement) {
      const container = this.slideContainer.nativeElement;
      const items = container.querySelectorAll('.slide-item');
      const accentLine = container.querySelector('.accent-line');
      
      // Main container entrance
      animate(
        container,
        { 
          opacity: [0, 1], 
          scale: [0.85, 1],
          x: [dir === 1 ? 200 : -200, 0],
          y: [dir === 1 ? 30 : -30, 0],
          filter: ['blur(16px)', 'blur(0px)']
        },
        { duration: 0.9, ease: customEase }
      ).finished.then(() => {
        this.isTransitioning.set(false);
      });

      // Accent line draws in from left
      if (accentLine) {
        animate(
          accentLine,
          { scaleX: [0, 1], opacity: [0, 1] },
          { duration: 0.8, delay: 0.2, ease: customEase }
        );
      }

      // Staggered items with vertical offset
      if (items.length > 0) {
        animate(
          items,
          { 
            opacity: [0, 1], 
            x: [dir === 1 ? 40 : -40, 0],
            y: [15, 0],
            filter: ['blur(6px)', 'blur(0px)']
          },
          { delay: stagger(0.07), duration: 0.7, ease: customEase }
        );
      }
    } else if (!this.crawlContainer?.nativeElement) {
       setTimeout(() => this.isTransitioning.set(false), 500);
    }
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyDown(event: KeyboardEvent) {
    if (this.isTransitioning()) return;
    // Block keyboard nav until presentation has started
    if (!this.hasStarted()) {
      if (event.key === ' ' || event.key === 'Enter') {
        this.startPresentation();
      }
      return;
    }
    if (event.key === 'ArrowRight' || event.key === ' ') {
      this.nextSlide();
    } else if (event.key === 'ArrowLeft') {
      this.prevSlide();
    }
  }

  async nextSlide() {
    if (this.currentIndex() < this.totalSlides() - 1 && !this.isTransitioning()) {
      this.isTransitioning.set(true);
      this.direction.set(1);
      await this.animateSlideOut(1);
      this.currentIndex.update(i => i + 1);
    }
  }

  async prevSlide() {
    if (this.currentIndex() > 0 && !this.isTransitioning()) {
      this.isTransitioning.set(true);
      this.direction.set(-1);
      await this.animateSlideOut(-1);
      this.currentIndex.update(i => i - 1);
    }
  }

  revealAnswer() {
    this.isAnswerRevealed.set(true);
    if (this.isBrowser) {
      // Triple burst confetti cascade
      const colors = ['#ffe81f', '#0044ff', '#ff3300', '#4ade80', '#a855f7'];
      confetti({ particleCount: 80, spread: 60, origin: { x: 0.25, y: 0.6 }, colors, startVelocity: 45 });
      setTimeout(() => confetti({ particleCount: 150, spread: 100, origin: { x: 0.5, y: 0.4 }, colors, startVelocity: 55 }), 150);
      setTimeout(() => confetti({ particleCount: 80, spread: 120, origin: { x: 0.75, y: 0.5 }, colors, startVelocity: 40 }), 350);
    }
  }

  nextQuizQuestion() {
    this.isAnswerRevealed.set(false);
    this.currentQuizQuestionIndex.update(i => i + 1);
  }
}
